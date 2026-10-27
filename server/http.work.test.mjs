import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {generateKeyPairSync,sign} from 'node:crypto'
import {createFridayServer} from './http.mjs'
import {createPrivateWorkReadBridge} from './work/private-read-bridge.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const access={enabled:true,teamDomain:'https://fixture.cloudflareaccess.com',
 audience:'friday-work-fixture',operatorEmails:[]}
const raw=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
function token(subject='trusted-123',override={}){
 const head=raw({alg:'RS256',kid:'k1'})
 const payload=raw({iss:access.teamDomain,aud:access.audience,
  sub:subject,email:'operator@example.test',exp:Math.floor(Date.now()/1000)+600,...override})
 const signed=head+'.'+payload
 return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url')
}
function configuration(){
 return {mode:'live',access,ai:{enabled:false},monitoring:{enabled:false}}
}
async function withServer(workReadBridge,fn,{withOuterGate=false}={}){
 const server=createFridayServer({
  config:configuration(),workReadBridge,
  // The existing general API gate is independently tested in http tests.
  // These tests exercise the work bridge's independently verified JWT.
  ...(!withOuterGate?{accessGateImpl:async()=>({status:200})}:{accessGateImpl:async req=>req.headers['cf-access-jwt-assertion']?{status:200}:{status:403}}),
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try {return await fn('http://127.0.0.1:'+server.address().port)}
 finally{server.close();await once(server,'close')}
}
const project='friday-ai-os',other='other-project'
const task={id:'work-1',projectId:project,title:'Approved scope',status:'ready',version:1}
const memory={id:'memory-1',scope:'project',ownerId:project,projectId:project,
 content:'Project milestones complete',provenance:'trusted-source'}
function bridge(logs=[],opts={}){
 const workService={
  async list({actor,projectId,limit}){logs.push({action:'list',actor,projectId,limit});return [task]},
  async get({actor,workItemId}){logs.push({action:'get',actor,workItemId});return task},
  ...opts.workService,
 }
 const memoryService={
  async search({actor,scopes,query,limit}){logs.push({action:'search',actor,scopes,query,limit});return [memory]},
  ...opts.memoryService,
 }
 return createPrivateWorkReadBridge({
  enabled:true,access,workService,memoryService,
  grantsForSubject:async sub=>sub==='trusted-123'?{
   allowedProjectIds:[project],allowedMemoryScopes:[{scope:'project',ownerId:project}]
  }:(()=>{throw Error('denied')})(),
  fetchKeys:async()=>({ok:true,json:async()=>({keys:[{...publicKey.export({format:'jwk'}),
   kid:'k1',alg:'RS256',use:'sig'}]})}),
 })
}
async function get(base,path,jwt=token()){
 return fetch(base+path,{headers:jwt?{'cf-access-jwt-assertion':jwt}:{}})
}
test('work endpoints do not exist without an explicitly enabled verified bridge',async()=>{
 await withServer(null,async base=>{
  for(const path of ['/api/work/tasks?projectId=friday-ai-os',
   '/api/work/tasks/work-1','/api/work/memory?projectId=friday-ai-os']){
   const response=await get(base,path)
   assert.equal(response.status,404)
   assert.deepEqual(await response.json(),{error:'not-found'})
  }
 })
})
test('authenticated human reads return only bounded task and project memory DTOs',async()=>{
 const calls=[]
 await withServer(bridge(calls),async base=>{
  const one=await get(base,'/api/work/tasks?projectId=friday-ai-os&limit=2')
  assert.equal(one.status,200)
  assert.equal(one.headers.get('cache-control'),'no-store')
  assert.deepEqual(await one.json(),{tasks:[task]})
  const two=await get(base,'/api/work/tasks/work-1')
  assert.equal(two.status,200);assert.deepEqual(await two.json(),{task})
  const three=await get(base,'/api/work/memory?projectId=friday-ai-os&q=milestones&limit=3')
  assert.equal(three.status,200)
  assert.deepEqual(await three.json(),{memories:[memory]})
  assert.deepEqual(calls.map(x=>x.action),['list','get','search'])
  assert.deepEqual(calls[2].scopes,[{scope:'project',ownerId:project}])
  assert.ok(calls.every(c=>c.actor.allowedAgentIds.length===0))
 })
})
test('untrusted, signed different subject, forged email, unsigned, and service identity all deny before DB reads',async()=>{
 const calls=[]
 await withServer(bridge(calls),async base=>{
  const forged=token('untrusted-123',{email:'operator@example.test',role:'Administrator'})
  const cases=[null,forged,token('trusted-123',{aud:'wrong'}),
   token('trusted-123',{exp:1}),token('trusted-123',{type:'app',sub:''}),
   token().replace(/.$/,'X'),'abc.def.ghi']
  for(const jwt of cases){
   const response=await get(base,'/api/work/tasks?projectId=friday-ai-os',jwt)
   assert.equal(response.status,403)
   assert.deepEqual(await response.json(),{error:'work-read-denied'})
  }
  assert.deepEqual(calls,[])
 })
})
test('exact project membership applies to task list, individual task and project memory',async()=>{
 const calls=[]
 await withServer(bridge(calls),async base=>{
  for(const path of ['/api/work/tasks?projectId=other-project',
   '/api/work/memory?projectId=other-project&q=milestones']){
   const response=await get(base,path)
   assert.equal(response.status,403)
  }
  assert.equal(calls.length,0)
 })
 const wrong=bridge([],{
  workService:{async list(){return [{...task,projectId:other}]}},
  memoryService:{async search(){return [{...memory,projectId:other}]}}
 })
 await withServer(wrong,async base=>{
  assert.equal((await get(base,'/api/work/tasks?projectId=friday-ai-os')).status,403)
  assert.equal((await get(base,'/api/work/memory?projectId=friday-ai-os&q=milestones')).status,403)
 })
})
test('strict GET-only shapes reject ambiguous, excessive, malformed and unsafe inputs',async()=>{
 const calls=[]
 await withServer(bridge(calls),async base=>{
  const malformed=['/api/work/tasks','/api/work/tasks?projectId=',
   '/api/work/tasks?projectId=friday-ai-os&projectId=other-project',
   '/api/work/tasks?projectId=friday-ai-os&limit=100',
   '/api/work/tasks?projectId=friday-ai-os&limit=0',
   '/api/work/tasks?projectId=friday-ai-os&role=admin',
   '/api/work/tasks/a%2Fb',
   '/api/work/memory?projectId=friday-ai-os&q=milestones&q=other',
   '/api/work/memory?projectId=friday-ai-os&scope=global',
   '/api/work/memory?projectId=friday-ai-os&limit=21']
  for(const path of malformed){
   const result=await get(base,path)
   assert.equal(result.status,400,path)
  }
  assert.deepEqual(calls,[])
  for(const method of ['POST','PUT','PATCH','DELETE']){
   const result=await fetch(base+'/api/work/tasks?projectId=friday-ai-os',
    {method,headers:{'cf-access-jwt-assertion':token(),
      'content-type':'application/json'},body:method==='DELETE'?undefined:'{}'})
   assert.equal(result.status,404)
  }
  assert.deepEqual(calls,[])
 })
})
test('unexpected storage failures sanitize their error and never return 200 empty results',async()=>{
 const broken=bridge([], {workService:{async list(){throw Error('db password key SECRET')}},
  memoryService:{async search(){return Promise.reject(Error('private token secret'))}}})
 await withServer(broken,async base=>{
  for(const p of ['/api/work/tasks?projectId=friday-ai-os',
   '/api/work/memory?projectId=friday-ai-os&q=milestones']){
   const r=await get(base,p)
   assert.equal(r.status,403)
   assert.deepEqual(await r.json(),{error:'work-read-denied'})
  }
 })
})
test('existing outer API gate still blocks unsigned requests before work bridge',async()=>{
 const calls=[]
 await withServer(bridge(calls),async base=>{
  const result=await get(base,'/api/work/tasks?projectId=friday-ai-os',null)
  assert.equal(result.status,403)
  assert.deepEqual(calls,[])
 },{withOuterGate:true})
})
