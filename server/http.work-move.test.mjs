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
const taskId='0f8fad5b-d9cb-469f-a165-70867728950e'
const moved={id:taskId,projectId:project,title:'Write release notes',status:'in_progress',version:2}

function writer({calls=[],canMove=true,move}={}){
 return {enabled:true,canMove,async create(){throw Error('unused')},
  move:move||(async input=>{calls.push(input);return moved})}
}
function bridge(taskWriter){
 return createPrivateWorkReadBridge({
  enabled:true,access,
  workService:{async list(){return []},async get(){return null}},
  memoryService:{async search(){return []}},
  grantsForSubject:async sub=>{
   if(sub!=='trusted-123')throw Error('denied')
   return {allowedProjectIds:[project],allowedMemoryScopes:[]}
  },
  fetchKeys:async()=>({ok:true,json:async()=>({keys:[{...publicKey.export({format:'jwk'}),kid:'k1',alg:'RS256',use:'sig'}]})}),
  taskWriter,
 })
}
async function withServer(workReadBridge,fn,{gate,actionAudit}={}){
 const server=createFridayServer({config:{mode:'live',access,ai:{enabled:false},monitoring:{enabled:false}},
  workReadBridge,actionAudit,accessGateImpl:gate||(async()=>({status:200,identity:{subject:'trusted-123',email:'operator@example.test'}}))})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try{return await fn('http://127.0.0.1:'+server.address().port)}
 finally{server.close();await once(server,'close')}
}
const body={projectId:project,expectedVersion:1,status:'in_progress',requestId:'claim-1'}
function post(base,payload=body,{jwt=token(),headers={},path='/api/work/tasks/'+taskId+'/move'}={}){
 return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',
  'cf-access-jwt-assertion':jwt,...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)})
}

test('the move route is 404 and canMove is absent until moves are enabled',async()=>{
 await withServer(bridge(writer({canMove:false})),async base=>{
  assert.equal((await post(base)).status,404)
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[],canCreate:true})
 })
})

test('an operator with a project grant claims a task; the gate is operator-only and it is audited',async()=>{
 const calls=[],audit=[],gateCalls=[]
 const actionAudit={async record(entry){audit.push(entry);return {requestId:'11111111-1111-4111-8111-111111111111'}}}
 const gate=async(_request,operatorOnly)=>{gateCalls.push(operatorOnly);return {status:200,identity:{subject:'trusted-123',email:'operator@example.test'}}}
 await withServer(bridge(writer({calls})),async base=>{
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[],canCreate:true,canMove:true})
  const response=await post(base)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{task:moved})
 },{gate,actionAudit})
 assert.deepEqual(gateCalls,[false,true])
 assert.deepEqual(calls,[{workItemId:taskId,projectId:project,expectedVersion:1,
  principalId:'access:'+createHash('sha256').update('trusted-123').digest('hex'),status:'in_progress',requestId:'claim-1'}])
 assert.deepEqual(audit.map(e=>[e.action,e.phase,e.target]),
  [['work.tasks.move','requested',taskId],['work.tasks.move','succeeded',taskId]])
})

test('non-operators, other people and ungranted projects are denied before any write',async()=>{
 const calls=[]
 await withServer(bridge(writer({calls})),async base=>{
  for(const [payload,jwt] of [[body,token({email:'viewer@example.test'})],[body,token({subject:'someone-else'})],
   [{...body,projectId:'other-project'},token()],[body,'not.a.jwt']]){
   const response=await post(base,payload,{jwt})
   assert.equal(response.status,403)
   assert.deepEqual(await response.json(),{error:'work-write-denied'})
  }
 })
 assert.equal(calls.length,0)
})

test('malformed moves are rejected before any write',async()=>{
 const calls=[]
 await withServer(bridge(writer({calls})),async base=>{
  for(const payload of [{...body,status:'running'},{...body,expectedVersion:0},{...body,expectedVersion:'1'},
   {projectId:project,status:'ready',requestId:'r'},{...body,principalId:'access:x'},[],'not json'])
   assert.equal((await post(base,payload)).status,400,JSON.stringify(payload))
  assert.equal((await post(base,body,{path:'/api/work/tasks/'+taskId+'/move?x=1'})).status,400)
  assert.equal((await post(base,body,{path:'/api/work/tasks/not-a-uuid/move'})).status,404)
  assert.equal((await post(base,body,{headers:{'content-type':'text/plain'}})).status,415)
  assert.equal((await post(base,body,{headers:{'sec-fetch-site':'cross-site'}})).status,403)
 })
 assert.equal(calls.length,0)
})

test('a changed task is 409, a refused transition 400 and storage failures are sanitized',async()=>{
 const failing=code=>writer({move:async()=>{const e=Error('db password SECRET');e.code=code;throw e}})
 for(const [code,status,error] of [['conflict',409,'work-task-changed'],['invalid',400,'invalid-work-task-move'],
  ['denied',403,'work-write-denied'],[undefined,503,'work-write-unavailable']]){
  await withServer(bridge(failing(code)),async base=>{
   const response=await post(base)
   assert.equal(response.status,status)
   assert.deepEqual(await response.json(),{error})
  })
 }
 await withServer(bridge(writer({move:async()=>({...moved,id:'00000000-0000-4000-8000-000000000000'})})),async base=>{
  assert.equal((await post(base)).status,503)
 })
})
