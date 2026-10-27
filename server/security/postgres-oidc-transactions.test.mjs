import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createPostgresOidcTransactions} from './postgres-oidc-transactions.mjs'

const NOW=1793090000000
const control=()=>randomBytes(32).toString('base64url')
const example=(applicationId='family')=>({
 state:control(),applicationId,
 issuer:'https://'+(applicationId==='family'?'family-login':'login')+'.example.test/application/o/'+applicationId+'/',
 clientId:applicationId+'-web',nonce:control(),verifier:control(),
 issuedAt:NOW,expiresAt:NOW+300000,
})
const rows=new Map()
function memory(){
 const history=[],table=new Map(),responses=[]
 let time=NOW
 const query=async(sql,params)=>{
  history.push({sql,params})
  if(responses.length)return responses.shift()
  const [app,digest]=params
  if(sql.startsWith('INSERT')){
   const key=app+':'+digest
   if(table.has(key))return {rowCount:0,rows:[]}
   table.set(key,{application_id:app,state_hash:digest,iv:params[2],
    tag:params[3],ciphertext:params[4],issued_at_ms:params[5],expires_at_ms:params[6]})
   return {rowCount:1,rows:[{ok:1}]}
  }
  if(sql.startsWith('DELETE')&&sql.includes('RETURNING application_id')){
   const key=app+':'+digest,record=table.get(key)
   if(!record||record.expires_at_ms<=params[2])return {rowCount:0,rows:[]}
   table.delete(key)
   return {rowCount:1,rows:[record]}
  }
  return {rowCount:0,rows:[]}
 }
 const make=(app='family',key=keyFamily)=>createPostgresOidcTransactions({
  enabled:true,applicationId:app,key,query,now:()=>time,
 })
 return {make,history,table,responses,setTime:t=>{time=t},query}
}
const keyFamily=randomBytes(32)
const keyBusiness=randomBytes(32)

test('default-off, unknown tenant, invalid key or missing query never touches database',async()=>{
 for(const opts of [{},{enabled:true},{enabled:true,applicationId:'family',key:randomBytes(8),query:async()=>{}},
  {enabled:true,applicationId:'other',key:keyFamily,query:async()=>{}},
  {enabled:true,applicationId:'family',key:keyFamily},
 ]){
  const store=createPostgresOidcTransactions(opts)
  assert.equal(store.enabled,false)
  await assert.rejects(store.reserve(example()),/sso-denied/)
  await assert.rejects(store.consume(control()),/sso-denied/)
 }
})

test('reserve commits only encrypted nonce/verifier/state and opaque keyed digest',async()=>{
 const f=memory(),tx=example()
 await f.make().reserve(tx)
 assert.equal(f.history.length,1)
 const {sql,params}=f.history[0]
 assert.match(sql,/INSERT INTO friday_identity\.oidc_transactions/)
 assert.match(sql,/ON CONFLICT DO NOTHING/)
 assert.equal(params[0],'family')
 assert.match(params[1],/^[a-f0-9]{64}$/)
 assert.notEqual(params[1],tx.state)
 assert.equal(params[5],tx.issuedAt)
 assert.equal(params[6],tx.expiresAt)
 const combined=JSON.stringify(f.table)
 const durable=JSON.stringify([...f.table.values()])
 for(const secret of [tx.state,tx.nonce,tx.verifier,tx.clientId,tx.issuer]){
  assert.equal(durable.includes(secret),false)
  assert.equal(sql.includes(secret),false)
 }
 assert.equal(sql.includes('$7'),true)
 assert.equal(combined.includes('PRIVATE'),false)
})

test('same database across instances: one consume wins, replay never authenticates',async()=>{
 const f=memory(),tx=example()
 await f.make().reserve(tx)
 const attempts=await Promise.allSettled(Array.from({length:6},()=>f.make().consume(tx.state)))
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1)
 assert.deepEqual(attempts.find(x=>x.status==='fulfilled').value,tx)
 assert.equal(attempts.filter(x=>x.status==='rejected').length,5)
 assert.equal(f.table.size,0)
 await assert.rejects(f.make().consume(tx.state),/sso-denied/)
})

test('family and TechTactics have separate pinned store, encryption key and state namespace',async()=>{
 const f=memory(),family=example('family'),business=example('techtactics')
 const fam=f.make(),biz=f.make('techtactics',keyBusiness)
 await fam.reserve(family)
 await biz.reserve(business)
 const secret=family.state
 await assert.rejects(biz.consume(secret),/sso-denied/)
 await assert.rejects(fam.reserve(business),/sso-denied/)
 await assert.rejects(biz.reserve(family),/sso-denied/)
 assert.deepEqual(await biz.consume(business.state),business)
 assert.deepEqual(await fam.consume(family.state),family)
})

test('wrong encryption key cannot consume, tampered payload burns matched transaction',async()=>{
 const f=memory(),tx=example()
 await f.make().reserve(tx)
 await assert.rejects(f.make('family',randomBytes(32)).consume(tx.state),/sso-denied/)
 // Different key produces a different opaque index and cannot consume
 // another key's transaction. The right key still wins exactly once.
 assert.deepEqual(await f.make().consume(tx.state),tx)
 await assert.rejects(f.make().consume(tx.state),/sso-denied/)
 const tx2=example()
 await f.make().reserve(tx2)
 const record=[...f.table.values()][0]
 record.tag='invalid'
 await assert.rejects(f.make().consume(tx2.state),/sso-denied/)
 assert.equal(f.table.size,0)
})

test('expired and clock-rollback transactions cannot complete or be recreated',async()=>{
 const f=memory(),expired=example()
 await f.make().reserve(expired)
 f.setTime(NOW+300001)
 await assert.rejects(f.make().consume(expired.state),/sso-denied/)
 f.setTime(NOW-1)
 await assert.rejects(f.make().reserve(example()),/sso-denied/)
 f.setTime(NOW)
 const tx=example()
 await f.make().reserve(tx)
 f.setTime(NOW-10)
 await assert.rejects(f.make().consume(tx.state),/sso-denied/)
})

test('rejects forged fields, unsafe tenant, invalid subject/issuer and long lifetimes',async()=>{
 const f=memory(),v=example()
 for(const row of [
  {...v,role:'Administrator'},{...v,state:'../../etc/passwd'},
  {...v,nonce:'bad'},{...v,verifier:'bad'},
  {...v,expiresAt:NOW+3600000},{...v,issuedAt:NOW+1},
  {...v,issuer:'http://family-login.example.test/application/o/family/'},
  {...v,applicationId:'techtactics'},
  {...v,clientId:''},
 ]){
  await assert.rejects(f.make().reserve(row),/sso-denied/)
 }
 await assert.rejects(f.make().consume('raw-cookie'),/sso-denied/)
 assert.equal(f.history.length,0)
})

test('SQL failure, replay collision, invalid row-count and malformed response all deny',async()=>{
 const f=memory(),tx=example()
 f.responses.push({rowCount:0,rows:[]})
 await assert.rejects(f.make().reserve(tx),/sso-denied/)
 f.responses.push({rowCount:2,rows:[{},{}]})
 await assert.rejects(f.make().reserve(tx),/sso-denied/)
 f.responses.push({rowCount:1,rows:null})
 await assert.rejects(f.make().reserve(tx),/sso-denied/)
 f.responses.push(null)
 await assert.rejects(f.make().reserve(tx),/sso-denied/)
 await f.make().reserve(tx)
 f.responses.push({rowCount:1,rows:[{bad:'row'}]})
 await assert.rejects(f.make().consume(tx.state),/sso-denied/)
})

test('cleanup is site-scoped, bounded, uses SKIP LOCKED and cannot be browser-triggered',async()=>{
 const f=memory()
 const store=f.make()
 f.responses.push({rowCount:2,rows:[{ok:1},{ok:1}]})
 assert.equal(await store.cleanup({limit:25}),2)
 const q=f.history[0]
 assert.match(q.sql,/FOR UPDATE SKIP LOCKED/)
 assert.match(q.sql,/friday_identity\.oidc_transactions/)
 assert.deepEqual(q.params,['family',NOW,25])
 await assert.rejects(store.cleanup({limit:1001}),/sso-denied/)
 await assert.rejects(store.cleanup({applicationId:'techtactics',limit:2}),/sso-denied/)
})
