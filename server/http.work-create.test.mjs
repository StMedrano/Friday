import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createHash,generateKeyPairSync,sign} from 'node:crypto'
import {createFridayServer} from './http.mjs'
import {createPrivateWorkReadBridge} from './work/private-read-bridge.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const access={enabled:true,teamDomain:'https://fixture.cloudflareaccess.com',
 audience:'friday-work-fixture',operatorEmails:['operator@example.test']}
const raw=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
function token({subject='trusted-123',email='operator@example.test'}={}){
 const signed=raw({alg:'RS256',kid:'k1'})+'.'+raw({iss:access.teamDomain,aud:access.audience,
  sub:subject,email,exp:Math.floor(Date.now()/1000)+600})
 return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url')
}
const project='friday-ai-os'
const created={id:'0f8fad5b-d9cb-469f-a165-70867728950e',projectId:project,title:'Write release notes',status:'ready',version:1}

function bridge({writer,calls=[]}={}){
 return createPrivateWorkReadBridge({
  enabled:true,access,
  workService:{async list(){return []},async get(){return null}},
  memoryService:{async search(){return []}},
  grantsForSubject:async sub=>{
   if(sub!=='trusted-123')throw Error('denied')
   return {allowedProjectIds:[project],allowedMemoryScopes:[]}
  },
  fetchKeys:async()=>({ok:true,json:async()=>({keys:[{...publicKey.export({format:'jwk'}),kid:'k1',alg:'RS256',use:'sig'}]})}),
  taskWriter:writer===undefined?{enabled:true,async create(input){calls.push(input);return created}}:writer,
 })
}
async function withServer(workReadBridge,fn,{gate,actionAudit}={}){
 const server=createFridayServer({config:{mode:'live',access,ai:{enabled:false},monitoring:{enabled:false}},
  workReadBridge,actionAudit,accessGateImpl:gate||(async()=>({status:200,identity:{subject:'trusted-123',email:'operator@example.test'}}))})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try{return await fn('http://127.0.0.1:'+server.address().port)}
 finally{server.close();await once(server,'close')}
}
function post(base,body,{jwt=token(),headers={},path='/api/work/tasks'}={}){
 return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',
  'cf-access-jwt-assertion':jwt,...headers},body:typeof body==='string'?body:JSON.stringify(body)})
}

test('without the writer the route stays 404 and the task list does not offer New task',async()=>{
 await withServer(bridge({writer:null}),async base=>{
  const response=await post(base,{projectId:project,title:'A task',requestId:'req-1'})
  assert.equal(response.status,404)
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[]})
 })
 await withServer(bridge({writer:{enabled:false,async create(){throw Error('unused')}}}),async base=>{
  assert.equal((await post(base,{projectId:project,title:'A task',requestId:'req-1'})).status,404)
 })
})

test('an operator with a project grant creates a ready task; it is audited',async()=>{
 const calls=[],audit=[]
 const actionAudit={async record(entry){audit.push(entry);return {requestId:'11111111-1111-4111-8111-111111111111'}}}
 const gateCalls=[]
 const gate=async(_request,operatorOnly)=>{gateCalls.push(operatorOnly);return {status:200,identity:{subject:'trusted-123',email:'operator@example.test'}}}
 await withServer(bridge({calls}),async base=>{
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[],canCreate:true})
  const response=await post(base,{projectId:project,title:'  Write release notes ',requestId:'req-1'})
  assert.equal(response.status,201)
  assert.deepEqual(await response.json(),{task:created})
 },{gate,actionAudit})
 assert.deepEqual(gateCalls,[false,true])
 assert.equal(calls.length,1)
 const expectedPrincipal='access:'+createHash('sha256').update('trusted-123').digest('hex')
 assert.deepEqual(calls[0],{projectId:project,title:'Write release notes',objective:'Write release notes',
  principalId:expectedPrincipal,requestId:'req-1',
  inputFingerprint:createHash('sha256').update(JSON.stringify({projectId:project,title:'Write release notes',objective:'Write release notes'})).digest('hex')})
 assert.deepEqual(audit.map(e=>[e.action,e.phase,e.target]),
  [['work.tasks.create','requested',project],['work.tasks.create','succeeded',project]])
})

test('non-operators, other people and ungranted projects are denied before any write',async()=>{
 const calls=[]
 await withServer(bridge({calls}),async base=>{
  for(const [body,jwt] of [
   [{projectId:project,title:'A',requestId:'r1'},token({email:'viewer@example.test'})],
   [{projectId:project,title:'A',requestId:'r2'},token({subject:'someone-else'})],
   [{projectId:'other-project',title:'A',requestId:'r3'},token()],
   [{projectId:project,title:'A',requestId:'r4'},'not.a.jwt'],
  ]){
   const response=await post(base,body,{jwt})
   assert.equal(response.status,403)
   assert.deepEqual(await response.json(),{error:'work-write-denied'})
  }
 })
 assert.equal(calls.length,0)
})

test('malformed requests are rejected before any write',async()=>{
 const calls=[]
 await withServer(bridge({calls}),async base=>{
  for(const body of [{projectId:project,requestId:'r'},{projectId:project,title:'A'},
   {projectId:project,title:'A',requestId:'r',status:'in_progress'},
   {projectId:project,title:'x'.repeat(161),requestId:'r'},
   {projectId:project,title:'A',objective:'x'.repeat(4001),requestId:'r'},
   {projectId:project,title:'password = hunter2',requestId:'r'},
   [],'not json']){
   assert.equal((await post(base,body)).status,400,JSON.stringify(body))
  }
  assert.equal((await post(base,{projectId:project,title:'A',requestId:'r'},{path:'/api/work/tasks?projectId=x'})).status,400)
  assert.equal((await post(base,{projectId:project,title:'A',requestId:'r'},{headers:{'content-type':'text/plain'}})).status,415)
  assert.equal((await post(base,{projectId:project,title:'A',requestId:'r'},{headers:{'sec-fetch-site':'cross-site'}})).status,403)
 })
 assert.equal(calls.length,0)
})

test('a reused request id is a conflict and storage failures are sanitized',async()=>{
 const conflict={enabled:true,async create(){const e=Error('x');e.code='conflict';throw e}}
 await withServer(bridge({writer:conflict}),async base=>{
  const response=await post(base,{projectId:project,title:'A',requestId:'r'})
  assert.equal(response.status,409)
  assert.deepEqual(await response.json(),{error:'work-task-request-reused'})
 })
 const broken={enabled:true,async create(){throw Error('db password SECRET')}}
 await withServer(bridge({writer:broken}),async base=>{
  const response=await post(base,{projectId:project,title:'A',requestId:'r'})
  assert.equal(response.status,503)
  assert.deepEqual(await response.json(),{error:'work-write-unavailable'})
 })
 const wrongRow={enabled:true,async create(){return {...created,projectId:'other-project'}}}
 await withServer(bridge({writer:wrongRow}),async base=>{
  assert.equal((await post(base,{projectId:project,title:'A',requestId:'r'})).status,503)
 })
})
