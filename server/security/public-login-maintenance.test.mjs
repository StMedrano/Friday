import test from 'node:test'
import assert from 'node:assert/strict'
import {createPublicLoginRuntime} from './public-login-runtime.mjs'

const NOW=1793090000000
const IDS=['family','techtactics']
const SUBJECT_A='authentik:0123456789abcdef:person-a'
const SUBJECT_B='authentik:fedcba9876543210:person-b'

function fixture(){
 const stores=IDS.map(id=>({
  id,transactions:new Map(),sessions:new Map(),queries:[],failSessionCleanup:false,
 }))
 const queries=stores.map(store=>async(sql,params)=>{
  store.queries.push({sql,params})
  const [app]=params
  if(app!==store.id)throw Error('wrong site database role')
  if(sql.startsWith('DELETE FROM friday_identity.web_sessions')&&
     sql.includes('subject=$2')){
   const subject=params[1],rows=[]
   for(const [key,row] of store.sessions){
    if(row.subject===subject){store.sessions.delete(key);rows.push({ok:1})}
   }
   return {rowCount:rows.length,rows}
  }
  if(sql.startsWith('WITH expired AS (')&&sql.includes('oidc_transactions')){
   const rows=[]
   for(const [key,row] of store.transactions){
    if(row.expiresAt<=params[1]&&rows.length<params[2]){
     store.transactions.delete(key);rows.push({ok:1})
    }
   }
   return {rowCount:rows.length,rows}
  }
  if(sql.startsWith('WITH expired AS (')&&sql.includes('web_sessions')){
   if(store.failSessionCleanup)throw Error('private-postgres-secret')
   const rows=[]
   for(const [key,row] of store.sessions){
    if(row.expiresAt<=params[1]&&rows.length<params[2]){
     store.sessions.delete(key);rows.push({ok:1})
    }
   }
   return {rowCount:rows.length,rows}
  }
  throw Error('only maintenance SQL permitted in fixture')
 })
 const sites=IDS.map((id,i)=>({
  id,publicOrigin:'https://'+id+'.example.test',
  identityOrigin:'https://identity-'+id+'.example.test',
  clientId:id+'-client',
  clientSecret:'server-only-fixture-'+id,
  signingKey:Buffer.alloc(32,i+1),
  transactionKey:Buffer.alloc(32,i+3),
  query:queries[i],
 }))
 const runtime=createPublicLoginRuntime({enabled:true,sites,now:()=>NOW})
 return {runtime,stores,sites}
}

test('disabled, malformed or unregistered site never exposes login maintenance',()=>{
 const f=fixture()
 assert.equal(f.runtime.enabled,true)
 assert.equal(f.runtime.maintenanceFor('other'),null)
 assert.equal(f.runtime.maintenanceFor(''),null)
 assert.equal(f.runtime.maintenanceFor({id:'family'}),null)
 assert.equal(typeof f.runtime.handlerFor('family'),'function')
 assert.equal(f.runtime.handlerFor('family').maintenanceFor,undefined)
 const unavailable=createPublicLoginRuntime({enabled:false,sites:f.sites})
 assert.equal(unavailable.maintenanceFor('family'),null)
 assert.equal(unavailable.maintenanceFor('techtactics'),null)
 assert.equal(f.stores.every(store=>store.queries.length===0),true)
})

test('trusted per-site offboarding deletes just the verified issuer-scoped subject',async()=>{
 const f=fixture()
 const [family,business]=f.stores
 for(const [key,subject] of [['f-a',SUBJECT_A],['f-b',SUBJECT_A],['f-other',SUBJECT_B]])
  family.sessions.set(key,{subject,expiresAt:NOW+60000})
 business.sessions.set('biz-person',{subject:SUBJECT_A,expiresAt:NOW+60000})
 const familyMaintenance=f.runtime.maintenanceFor('family')
 const businessMaintenance=f.runtime.maintenanceFor('techtactics')
 assert.equal(Object.isFrozen(familyMaintenance),true)
 assert.equal(familyMaintenance.enabled,true)
 assert.equal(await familyMaintenance.revokeSubject({subject:SUBJECT_A}),2)
 assert.deepEqual([...family.sessions.keys()],['f-other'])
 assert.equal(business.sessions.size,1)
 assert.deepEqual(family.queries[0].params,['family',SUBJECT_A])
 assert.equal(family.queries[0].sql.includes(SUBJECT_A),false)
 assert.equal(await familyMaintenance.revokeSubject({subject:SUBJECT_A}),0)
 assert.equal(await businessMaintenance.revokeSubject({subject:SUBJECT_A}),1)
 assert.equal(business.sessions.size,0)
 for(const input of [
  {},{subject:'person-a'},{subject:SUBJECT_A,applicationId:'techtactics'},
  {subject:SUBJECT_A,role:'Administrator'},
  {subject:'authentik:0123456789abcdef:bad token'},
 ])await assert.rejects(familyMaintenance.revokeSubject(input),/sso-denied/)
 assert.equal(family.queries.length,2)
})

test('bounded site-local maintenance sweeps expired PKCE state and sessions without active records',async()=>{
 const f=fixture()
 const [family,business]=f.stores
 for(let i=0;i<4;i++){
  family.transactions.set('f-t-'+i,{expiresAt:NOW-1})
  family.sessions.set('f-s-'+i,{subject:SUBJECT_A,expiresAt:NOW-1})
 }
 family.transactions.set('f-active',{expiresAt:NOW+1})
 family.sessions.set('f-active',{subject:SUBJECT_A,expiresAt:NOW+1})
 business.transactions.set('b-expired',{expiresAt:NOW-1})
 business.sessions.set('b-expired',{subject:SUBJECT_B,expiresAt:NOW-1})
 const maintenance=f.runtime.maintenanceFor('family')
 assert.deepEqual(await maintenance.cleanup({limit:2}),{
  expiredTransactions:2,expiredSessions:2,
 })
 assert.equal(family.transactions.size,3)
 assert.equal(family.sessions.size,3)
 assert.equal(business.transactions.size,1)
 assert.equal(business.sessions.size,1)
 assert.deepEqual(family.queries[0].params,['family',NOW,2])
 assert.deepEqual(family.queries[1].params,['family',NOW,2])
 assert.deepEqual(await maintenance.cleanup({limit:2}),{
  expiredTransactions:2,expiredSessions:2,
 })
 assert.deepEqual(await maintenance.cleanup({limit:2}),{
  expiredTransactions:0,expiredSessions:0,
 })
 assert.deepEqual([...family.transactions.keys()],['f-active'])
 assert.deepEqual([...family.sessions.keys()],['f-active'])
 assert.equal((await f.runtime.maintenanceFor('techtactics').cleanup({limit:2})).expiredSessions,1)
 for(const input of [
  {},{limit:0},{limit:1001},{limit:1.5},{limit:'2'},
  {limit:2,applicationId:'techtactics'},null,
 ])await assert.rejects(maintenance.cleanup(input),/sso-denied/)
})

test('a database failure rejects without claiming successful cleanup or crossing tenants',async()=>{
 const f=fixture(),family=f.stores[0],business=f.stores[1]
 family.transactions.set('expired',{expiresAt:NOW-1})
 family.sessions.set('expired',{subject:SUBJECT_A,expiresAt:NOW-1})
 business.sessions.set('business',{subject:SUBJECT_B,expiresAt:NOW-1})
 family.failSessionCleanup=true
 await assert.rejects(f.runtime.maintenanceFor('family').cleanup({limit:5}),error=>{
  assert.equal(error.message,'sso-denied')
  assert.equal(JSON.stringify(error).includes('private-postgres-secret'),false)
  return true
 })
 assert.equal(business.sessions.size,1)
 // A partial successful first sweep is safe to retry, never reported as success.
 assert.equal(family.transactions.size,0)
 assert.equal(family.sessions.size,1)
 family.failSessionCleanup=false
 assert.deepEqual(await f.runtime.maintenanceFor('family').cleanup({limit:5}),{
  expiredTransactions:0,expiredSessions:1,
 })
})
