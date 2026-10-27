import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createPostgresLoginSessions} from './postgres-login-sessions.mjs'

const NOW=1793034000000
const subject='authentik:0123456789abcdef:family-member-123'
const tokenHash=()=>randomBytes(32).toString('base64url')
const makeRow=(applicationId='family',extra={})=>({
 applicationId,tokenHash:tokenHash(),subject,
 createdAt:NOW,expiresAt:NOW+600000,...extra,
})
const fake=(implementation=async()=>({rowCount:1,rows:[{ok:1}]}))=>{
 const calls=[]
 const query=async(text,params)=>{calls.push({text,params});return implementation(text,params)}
 let clock=NOW
 return {calls,query,setTime:n=>{clock=n},store:createPostgresLoginSessions({
  enabled:true,query,now:()=>clock,
 })}
}

test('session store is disabled unless explicitly enabled with a server-provided DB query',async()=>{
 const disabled=createPostgresLoginSessions()
 assert.equal(disabled.enabled,false)
 await assert.rejects(disabled.create(makeRow()),/sso-denied/)
 await assert.rejects(disabled.read({applicationId:'family',tokenHash:tokenHash()}),/sso-denied/)
 await assert.rejects(disabled.revoke({applicationId:'family',tokenHash:tokenHash()}),/sso-denied/)
 const missing=createPostgresLoginSessions({enabled:true})
 assert.equal(missing.enabled,false)
 await assert.rejects(missing.create(makeRow()),/sso-denied/)
})

test('create writes only validated opaque digest and issuer-scoped subject through bound params',async()=>{
 const f=fake()
 const row=makeRow('family')
 await f.store.create(row)
 assert.equal(f.calls.length,1)
 const {text,params}=f.calls[0]
 assert.match(text,/INSERT INTO friday_identity\.web_sessions/i)
 assert.match(text,/ON CONFLICT DO NOTHING/i)
 assert.match(text,/RETURNING/i)
 assert.match(text,/\$1/)
 assert.match(text,/\$5/)
 assert.deepEqual(params,[row.applicationId,row.tokenHash,row.subject,row.createdAt,row.expiresAt])
 assert.equal(text.includes(row.tokenHash),false)
 assert.equal(text.includes(row.subject),false)
 assert.equal(text.includes('service_role'),false)
})

test('duplicate, failing and malformed database insert must deny rather than create unbacked login',async()=>{
 const row=makeRow()
 for(const implementation of [
  async()=>({rowCount:0,rows:[]}),
  async()=>{throw Error('private-database-password')},
  async()=>({rowCount:2,rows:[{},{}]}),
  async()=>null,
 ]){
  const f=fake(implementation)
  await assert.rejects(f.store.create(row),/sso-denied/)
 }
})

test('read is app-scoped, unexpired, and returns only exactly five verified fields',async()=>{
 const row=makeRow('techtactics')
 const f=fake(async()=>({rowCount:1,rows:[{
  application_id:row.applicationId,token_hash:row.tokenHash,subject:row.subject,
  created_at_ms:String(row.createdAt),expires_at_ms:String(row.expiresAt),
 }]}))
 assert.deepEqual(await f.store.read({applicationId:row.applicationId,tokenHash:row.tokenHash}),row)
 const call=f.calls[0]
 assert.match(call.text,/SELECT/i)
 assert.match(call.text,/application_id=\$1/i)
 assert.match(call.text,/token_hash=\$2/i)
 assert.match(call.text,/expires_at_ms>\$3/i)
 assert.deepEqual(call.params,[row.applicationId,row.tokenHash,NOW])
 assert.equal(call.text.includes(row.tokenHash),false)
})

test('missing sessions return null without exposing database exceptions or other-site records',async()=>{
 const row=makeRow()
 assert.equal(await fake(async()=>({rowCount:0,rows:[]})).store.read({
  applicationId:'family',tokenHash:row.tokenHash,
 }),null)
 for(const response of [
  {rowCount:1,rows:[{application_id:'techtactics',token_hash:row.tokenHash,
   subject:row.subject,created_at_ms:NOW,expires_at_ms:NOW+20000}]},
  {rowCount:1,rows:[{application_id:'family',token_hash:'invalid',
   subject:row.subject,created_at_ms:NOW,expires_at_ms:NOW+20000}]},
  {rowCount:1,rows:[{application_id:'family',token_hash:row.tokenHash,
   subject:'malformed email',created_at_ms:NOW,expires_at_ms:NOW+20000}]},
  {rowCount:1,rows:[{application_id:'family',token_hash:row.tokenHash,
   subject:row.subject,created_at_ms:NOW+100,expires_at_ms:NOW+20000}]},
  {rowCount:1,rows:[{application_id:'family',token_hash:row.tokenHash,
   subject:row.subject,created_at_ms:NOW,expires_at_ms:NOW-1}]},
  {rowCount:2,rows:[{},{}]},
  {rowCount:1,rows:null},
 ]){
  const f=fake(async()=>response)
  await assert.rejects(f.store.read({
   applicationId:'family',tokenHash:row.tokenHash,
  }),/sso-denied/)
 }
 await assert.rejects(fake(async()=>{throw Error('raw SQL host')}).store.read({
  applicationId:'family',tokenHash:row.tokenHash,
 }),/sso-denied/)
})

test('logout DELETE is atomic and site-scoped and does not clear another application',async()=>{
 const row=makeRow('techtactics')
 const f=fake()
 assert.equal(await f.store.revoke({applicationId:'techtactics',tokenHash:row.tokenHash}),true)
 const {text,params}=f.calls[0]
 assert.match(text,/DELETE FROM friday_identity\.web_sessions/i)
 assert.match(text,/application_id=\$1/i)
 assert.match(text,/token_hash=\$2/i)
 assert.match(text,/expires_at_ms>\$3/i)
 assert.deepEqual(params,['techtactics',row.tokenHash,NOW])
 assert.equal(await fake(async()=>({rowCount:0,rows:[]})).store.revoke({
  applicationId:'techtactics',tokenHash:row.tokenHash,
 }),false)
})

test('offboard only a requested signed subject from a single site and bound number of records',async()=>{
 const f=fake(async()=>({rowCount:2,rows:[{ok:1},{ok:1}]}))
 assert.equal(await f.store.revokeSubject({applicationId:'family',subject}),2)
 assert.match(f.calls[0].text,/DELETE FROM friday_identity\.web_sessions/i)
 assert.match(f.calls[0].text,/application_id=\$1/i)
 assert.match(f.calls[0].text,/subject=\$2/i)
 assert.deepEqual(f.calls[0].params,['family',subject])
 assert.equal(f.calls[0].text.includes(subject),false)
 await assert.rejects(f.store.revokeSubject({applicationId:'techtactics',subject:'a@b.test'}),/sso-denied/)
})

test('bounded per-site expiry sweeps use SKIP LOCKED, never delete active sessions',async()=>{
 const f=fake(async()=>({rowCount:3,rows:[{ok:1},{ok:1},{ok:1}]}))
 assert.equal(await f.store.cleanup({applicationId:'family',limit:50}),3)
 assert.match(f.calls[0].text,/FOR UPDATE SKIP LOCKED/i)
 assert.match(f.calls[0].text,/LIMIT \$3/i)
 assert.match(f.calls[0].text,/expires_at_ms<=\$2/i)
 assert.deepEqual(f.calls[0].params,['family',NOW,50])
 await assert.rejects(f.store.cleanup({applicationId:'family',limit:1001}),/sso-denied/)
 await assert.rejects(f.store.cleanup({applicationId:'unknown',limit:5}),/sso-denied/)
})

test('all session operations deny wrong app, raw tokens, invalid subject, bad time and extra input',async()=>{
 const f=fake()
 const invalid=[
  makeRow('other'),makeRow('family',{tokenHash:'browser-raw-cookie'}),
  makeRow('techtactics',{subject:'admin@example.test'}),
  makeRow('family',{subject:'authentik:0123456789abcdef:valid',expiresAt:NOW+7200000}),
  makeRow('family',{createdAt:NOW+1}),
  makeRow('family',{role:'Administrator'}),
 ]
 for(const row of invalid)await assert.rejects(f.store.create(row),/sso-denied/)
 for(const row of [
  {applicationId:'family',tokenHash:'__Host-secret'},
  {applicationId:'techtactics',tokenHash:tokenHash(),role:'Admin'},
  {applicationId:'family',tokenHash:''},
 ])await assert.rejects(f.store.read(row),/sso-denied/)
 await assert.rejects(f.store.revoke({applicationId:'other',tokenHash:tokenHash()}),/sso-denied/)
 f.setTime(NOW-1)
 await assert.rejects(f.store.create(makeRow()),/sso-denied/)
 assert.equal(f.calls.length,0)
})

test('database clock advancing cannot extend an existing session beyond its OIDC expiry',async()=>{
 const row=makeRow()
 const f=fake(async(_,params)=>({rowCount:1,rows:[{
  application_id:row.applicationId,token_hash:row.tokenHash,subject:row.subject,
  created_at_ms:row.createdAt,expires_at_ms:row.expiresAt,
 }]}))
 f.setTime(NOW+600001)
 await assert.rejects(f.store.read({applicationId:'family',tokenHash:row.tokenHash}),/sso-denied/)
})
