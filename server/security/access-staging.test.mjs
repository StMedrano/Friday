import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { getConfig } from '../config.mjs'
import { createFridayServer } from '../http.mjs'
import { createAccessGate } from './access.mjs'

const issuer='https://staging-team.cloudflareaccess.com'
const audience='friday-staging-identity-audience'
const origin='https://friday.mytechtactics.com'
const fixedTime=Math.floor(Date.now()/1000)
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...publicKey.export({format:'jwk'}),kid:'staging-rsa-key',alg:'RS256',use:'sig'}
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const baseClaims={
 iss:issuer,aud:[audience],iat:fixedTime-30,nbf:fixedTime-10,exp:fixedTime+600,
 sub:'synthetic-staging-user',type:'app',email:'operator@staging.test',custom:{friday_auth_source:'authentik'},
}
function jwt(claims=baseClaims,header={alg:'RS256',kid:'staging-rsa-key',typ:'JWT'}){
 const content=encode(header)+'.'+encode(claims)
 return content+'.'+sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url')
}
function forgeSignature(identity){
 const parts=identity.split('.')
 const original=Buffer.from(parts[2],'base64url')
 const forged=Buffer.from(original)
 forged[0]^=1
 parts[2]=forged.toString('base64url')
 assert.notDeepEqual(Buffer.from(parts[2],'base64url'),original,'forged fixture must alter signature bytes')
 return parts.join('.')
}
const token=jwt()
const viewerToken=jwt({...baseClaims,email:'viewer@staging.test'})
const fallbackClaims={...baseClaims,email:'fallback@staging.test'}
delete fallbackClaims.custom
const fallbackToken=jwt(fallbackClaims)
const headers=(identity,extra={})=>({
 ...(identity?{'cf-access-jwt-assertion':identity}:{}),
 ...extra,
})
async function withStaging(run){
 let calls={overview:0,agentList:0,sync:0,rerun:0,assistant:0}
 let jwksCalls=0
 const config=getConfig({
  FRIDAY_MODE:'live',
  FRIDAY_ACCESS_TEAM_DOMAIN:issuer,
  FRIDAY_ACCESS_AUD:audience,
  FRIDAY_ACCESS_OPERATOR_EMAILS:'operator@staging.test',
  FRIDAY_REGISTRY_SYNC_OPERATOR_TOKEN:'a'.repeat(64),
 })
 const accessGate=createAccessGate(config.access,{
  fetchImpl:async (url,{redirect})=>{
   assert.equal(url,issuer+'/cdn-cgi/access/certs')
   assert.equal(redirect,'error')
   jwksCalls++
   return new Response(JSON.stringify({keys:[jwk]}),{status:200})
  },
 })
 const server=createFridayServer({
  config,
  accessGateImpl:accessGate,
  buildOverviewImpl:async()=>{calls.overview++;return {services:[]}},
  agentRegistryService:{
   list:async()=>{calls.agentList++;return []},
   status:async()=>({status:'ready'}),
   get:async()=>null,
   sync:async()=>{calls.sync++;return {synced:true}},
  },
  monitoringRuntime:{
   getIncidents:()=>({incidents:[]}),
   rerunDiagnostic:async()=>{calls.rerun++;return {statusCode:200,body:{rerun:true}}},
  },
  answerAssistantImpl:async()=>{calls.assistant++;return {available:true,text:'staging fixture only'}},
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  await run('http://127.0.0.1:'+server.address().port,calls,()=>jwksCalls)
 }finally{await new Promise(resolve=>server.close(resolve))}
}

test('staging: no Access token denies operational APIs while edge-owned UI and health remain available',async()=>{
 await withStaging(async(base,calls)=>{
  for(const path of ['/api/overview','/api/agents']){
   const res=await fetch(base+path)
   assert.equal(res.status,403,'anonymous '+path)
  }
  const denied=await fetch(base+'/api/assistant',{
   method:'POST',headers:headers(null,{'content-type':'application/json'}),
   body:JSON.stringify({prompt:'is everything running?'}),
  })
  assert.equal(denied.status,403)
  const spoofed=await fetch(base+'/api/overview',{
   headers:{'cf-access-authenticated-user-email':'operator@staging.test'},
  })
  assert.equal(spoofed.status,403)
  assert.equal((await fetch(base+'/')).status,200)
  assert.equal((await fetch(base+'/healthz')).status,200)
  assert.equal((await fetch(base+'/api/health')).status,200)
  assert.deepEqual(calls,{overview:0,agentList:0,sync:0,rerun:0,assistant:0})
 })
})
test('staging: valid signed Access JWT grants read/AI but a viewer cannot sync or rerun diagnostics',async()=>{
 await withStaging(async(base,calls,jwksCalls)=>{
  assert.equal((await fetch(base+'/api/overview',{headers:headers(viewerToken)})).status,200)
  assert.equal((await fetch(base+'/api/agents',{headers:headers(viewerToken)})).status,200)
  const assistant=await fetch(base+'/api/assistant',{
   method:'POST',
   headers:headers(viewerToken,{'content-type':'application/json',origin}),
   body:JSON.stringify({prompt:'What is Friday?'}),
  })
  assert.equal(assistant.status,200)
  for(const route of ['/api/agents/registry/sync','/api/incidents/test/diagnostics/rerun']){
   const res=await fetch(base+route,{
    method:'POST',headers:headers(viewerToken,{'content-type':'application/json',origin,authorization:'Bearer '+'a'.repeat(64)}),body:'{}',
   })
   assert.equal(res.status,403,route)
  }
  assert.ok(jwksCalls()>=1)
  assert.deepEqual(calls,{overview:2,agentList:1,sync:0,rerun:0,assistant:1})
 })
})
test('staging: operator requires both signed identity and independent registry token; cross-origin denied',async()=>{
 await withStaging(async(base,calls)=>{
  const attempt=async(extra)=>fetch(base+'/api/agents/registry/sync',{
   method:'POST',
   headers:headers(token,{'content-type':'application/json',origin,...extra}),body:'{}',
  })
  assert.equal((await attempt({})).status,401)
  assert.equal((await attempt({authorization:'Bearer '+'b'.repeat(64)})).status,401)
  assert.equal((await attempt({authorization:'Bearer '+'a'.repeat(64),origin:'https://attacker.example','sec-fetch-site':'cross-site'})).status,403)
  assert.equal(calls.sync,0)
  assert.equal((await attempt({authorization:'Bearer '+'a'.repeat(64)})).status,200)
  assert.equal((await fetch(base+'/api/incidents/test/diagnostics/rerun',{
   method:'POST',headers:headers(token,{'content-type':'application/json',origin}),body:'{}',
  })).status,200)
  assert.equal(calls.sync,1)
  assert.equal(calls.rerun,1)
 })
})
test('staging: Cloudflare fallback uses a non-operator email and remains Viewer-only',async()=>{
 await withStaging(async(base,calls)=>{
  assert.equal((await fetch(base+'/api/overview',{headers:headers(fallbackToken)})).status,200)
  const sync=await fetch(base+'/api/agents/registry/sync',{
   method:'POST',headers:headers(fallbackToken,{'content-type':'application/json',origin,authorization:'Bearer '+'a'.repeat(64)}),body:'{}',
  })
  assert.equal(sync.status,403)
  assert.equal(calls.sync,0)
 })
})
test('staging: wrong issuer, audience, signature and expired JWT fail closed',async()=>{
 await withStaging(async(base,calls)=>{
  const candidates=[
   jwt({...baseClaims,iss:'https://attacker.cloudflareaccess.com'}),
   jwt({...baseClaims,aud:['attacker-audience']}),
   jwt({...baseClaims,exp:fixedTime-60}),
   jwt({...baseClaims,sub:'',email:'service@staging.test',common_name:'service-identity.access'}),
   jwt({...baseClaims}, {alg:'none',kid:'staging-rsa-key'}),
   forgeSignature(token),
  ]
  for(const forged of candidates){
   const res=await fetch(base+'/api/overview',{headers:headers(forged)})
   assert.equal(res.status,403,'forged or expired token')
  }
  assert.equal(calls.overview,0)
 })
})
test('staging: missing team/audience config fails closed in live mode',async()=>{
 const config=getConfig({FRIDAY_MODE:'live'})
 assert.equal(config.access.enabled,true)
 const server=createFridayServer({
  config,buildOverviewImpl:async()=>{throw Error('must never reach inventory')},
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/overview')
  assert.equal(res.status,503)
  assert.equal((await res.json()).error,'access-verification-unavailable')
 }finally{await new Promise(resolve=>server.close(resolve))}
})

test('staging: compiled Friday UI remains edge-protected while origin APIs require signed identity',async(t)=>{
 const {existsSync}=await import('node:fs')
 const {fileURLToPath}=await import('node:url')
 if(!existsSync(fileURLToPath(new URL('../../dist/index.html',import.meta.url)))){
  t.skip('requires npm run build; CI explicitly repeats this test after build')
  return
 }
 await withStaging(async(base)=>{
  const anon=await fetch(base+'/')
  assert.equal(anon.status,200)
  const valid=await fetch(base+'/',{headers:headers(viewerToken)})
  assert.equal(valid.status,200)
  assert.match(await valid.text(),/<!doctype html>/i)
  assert.equal(valid.headers.get('x-frame-options'),'DENY')
 })
})
