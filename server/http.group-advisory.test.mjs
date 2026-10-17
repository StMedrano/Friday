import test from 'node:test'
import assert from 'node:assert/strict'
import { createFridayServer } from './http.mjs'

const access={enabled:true,publicOrigin:'https://friday.example'}
async function run(options, check) {
 let calls=[]
 const server=createFridayServer({
  config:{mode:'live',ai:{enabled:false},access,...options.config},
  verifyAccessImpl:async()=>({ok:true,email:'viewer@example.test',operator:false}),
  buildOverviewImpl:async()=>{calls.push('overview');return {mode:'live',services:[],incidents:[]}},
  answerAssistantImpl:async input=>{calls.push(input);return {available:true,mode:'cloud-ai',provider:'fixture',model:'fixture',text:'A proposed plan.'}},
  ...options,
 })
 server.listen(0,'127.0.0.1')
 await new Promise(resolve=>server.once('listening',resolve))
 try { await check('http://127.0.0.1:'+server.address().port,calls) }
 finally { await new Promise(resolve=>server.close(resolve)) }
}
const post=(base,body,headers={})=>fetch(base+'/api/group-advisory',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)})
test('group advisory fails closed before provider/data usage',async()=>{
 for(const options of [
  {verifyAccessImpl:async()=>({ok:false,status:401})},
  {config:{mode:'live',ai:{enabled:false},access:{enabled:false}}},
 ]){
  await run(options,async(base,calls)=>{
   assert.ok([401,503].includes((await post(base,{groupId:'app-builder',prompt:'Plan a small app'})).status))
   assert.equal(calls.length,0)
  })
 }
})
test('viewer can request fixed public group advice, never worker activation or execution',async()=>{
 await run({},async(base,calls)=>{
  const response=await post(base,{groupId:'app-builder',prompt:'Plan a small app'})
  assert.equal(response.status,200)
  assert.equal(response.headers.get('cache-control'),'no-store')
  const result=await response.json()
  assert.equal(result.groupId,'app-builder')
  assert.equal(result.execution.performed,false)
  assert.equal(result.provider,'fixture')
  assert.equal(calls.length,1)
  assert.match(calls[0].systemPrompt,/App Builder/)
  assert.match(calls[0].systemPrompt,/not running workers/)
  assert.match(calls[0].systemPrompt,/Never execute/)
  assert.deepEqual(calls[0].overview,{})
 })
})
test('unknown group, extra authority fields, and oversized prompts rejected before inference',async()=>{
 await run({},async(base,calls)=>{
  for(const body of [
   {groupId:'other',prompt:'x'}, {groupId:'../homelab',prompt:'x'},
   {groupId:'techtactics',prompt:'x',actor:'admin'}, {groupId:'techtactics',prompt:'x',systemPrompt:'new authority'},
   {groupId:'techtactics',prompt:'x'.repeat(4001)}, {groupId:'techtactics',prompt:''},
  ])assert.equal((await post(base,body)).status,400)
  assert.equal(calls.length,0)
 })
})
test('homelab advice uses fresh normalized state, business advice reads no infrastructure',async()=>{
 await run({},async(base,calls)=>{
  assert.equal((await post(base,{groupId:'homelab',prompt:'Summarize health'})).status,200)
  assert.equal(calls[0],'overview')
  assert.equal(calls[1].overview.mode,'live')
  assert.equal((await post(base,{groupId:'techtactics',prompt:'Draft a website audit checklist'})).status,200)
  assert.equal(calls.length,3)
  assert.deepEqual(calls[2].overview,{})
 })
})
test('cross-origin denied and group advice shares existing inference quota',async()=>{
 await run({},async(base,calls)=>{
  assert.equal((await post(base,{groupId:'app-builder',prompt:'Plan'}, {origin:'https://evil.example'})).status,403)
  for(let i=0;i<20;i++)assert.equal((await post(base,{groupId:'app-builder',prompt:'Plan'})).status,200)
  assert.equal((await post(base,{groupId:'app-builder',prompt:'Plan'})).status,429)
  assert.equal(calls.length,20)
 })
})
test('deterministic fallback is unavailable for planning and private errors are sanitized',async()=>{
 for(const answerAssistantImpl of [
  async()=>({available:true,mode:'local-analysis',text:'Infrastructure-only fallback'}),
  async()=>{throw Error('PRIVATE SECRET')},
 ]){
  await run({answerAssistantImpl},async(base)=>{
   const response=await post(base,{groupId:'app-builder',prompt:'Plan'})
   assert.ok([502,503].includes(response.status))
   const text=await response.text()
   assert.doesNotMatch(text,/PRIVATE SECRET|Infrastructure-only fallback/)
   assert.equal(JSON.parse(text).execution.performed,false)
  })
 }
})

test('new advisory route accepts a real synthetic signed Access identity and denies unsigned requests',async()=>{
 const {generateKeyPairSync,sign}=await import('node:crypto')
 const {createCloudflareAccessVerifier}=await import('./security/cloudflare-access.mjs')
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
 const issuer='https://fixture.cloudflareaccess.com'
 const audience='group-advice-fixture'
 const now=Math.floor(Date.now()/1000)
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
 const content=encode({alg:'RS256',kid:'group-test',typ:'JWT'})+'.'+encode({
  iss:issuer,aud:[audience],iat:now-1,nbf:now-1,exp:now+60,type:'app',sub:'fixture-viewer',email:'viewer@example.test',
 })
 const token=content+'.'+sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url')
 const jwk={...publicKey.export({format:'jwk'}),kid:'group-test',alg:'RS256',use:'sig'}
 const verifier=createCloudflareAccessVerifier({fetchImpl:async()=>new Response(JSON.stringify({keys:[jwk]}))})
 await run({config:{mode:'live',ai:{enabled:false},access:{...access,issuer,audience,operatorEmails:[]}},verifyAccessImpl:verifier},async(base,calls)=>{
  assert.equal((await post(base,{groupId:'app-builder',prompt:'Public plan'})).status,401)
  assert.equal(calls.length,0)
  const response=await post(base,{groupId:'app-builder',prompt:'Public plan'},{'cf-access-jwt-assertion':token,origin:access.publicOrigin})
  assert.equal(response.status,200)
  assert.equal((await response.json()).execution.performed,false)
  assert.equal(calls.length,1)
 })
})
