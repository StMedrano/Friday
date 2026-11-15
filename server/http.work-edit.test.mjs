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
const edited={id:taskId,projectId:project,title:'Write the release notes',status:'ready',version:2}

function writer({calls=[],canEdit=true,edit}={}){
 return {enabled:true,canMove:false,canEdit,async create(){throw Error('unused')},async move(){throw Error('unused')},
  edit:edit||(async input=>{calls.push(input);return edited})}
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
const body={projectId:project,expectedVersion:1,title:'  Write the release notes  '}
function post(base,payload=body,{jwt=token(),headers={},path='/api/work/tasks/'+taskId+'/edit'}={}){
 return fetch(base+path,{method:'POST',headers:{'content-type':'application/json',
  'cf-access-jwt-assertion':jwt,...headers},body:typeof payload==='string'?payload:JSON.stringify(payload)})
}
const principal='access:'+createHash('sha256').update('trusted-123').digest('hex')

test('the edit route is 404 and canEdit is absent until edits are enabled',async()=>{
 await withServer(bridge(writer({canEdit:false})),async base=>{
  assert.equal((await post(base)).status,404)
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[],canCreate:true})
 })
})

test('an operator with a project grant edits a task; operator-only, trimmed, objective kept unless given, audited',async()=>{
 const calls=[],audit=[],gateCalls=[]
 const actionAudit={async record(entry){audit.push(entry);return {requestId:'11111111-1111-4111-8111-111111111111'}}}
 const gate=async(_request,operatorOnly)=>{gateCalls.push(operatorOnly);return {status:200,identity:{subject:'trusted-123',email:'operator@example.test'}}}
 await withServer(bridge(writer({calls})),async base=>{
  const list=await fetch(base+'/api/work/tasks?projectId='+project,{headers:{'cf-access-jwt-assertion':token()}})
  assert.deepEqual(await list.json(),{tasks:[],canCreate:true,canEdit:true})
  const response=await post(base)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{task:edited})
  assert.equal((await post(base,{...body,objective:' New objective '})).status,200)
  assert.equal((await post(base,{...body,objective:''})).status,200)
 },{gate,actionAudit})
 assert.deepEqual(gateCalls,[false,true,true,true])
 const base={workItemId:taskId,projectId:project,expectedVersion:1,principalId:principal,title:'Write the release notes'}
 assert.deepEqual(calls,[{...base,objective:null},{...base,objective:'New objective'},{...base,objective:null}])
 assert.deepEqual(audit.slice(0,2).map(e=>[e.action,e.phase,e.target]),
  [['work.tasks.edit','requested',taskId],['work.tasks.edit','succeeded',taskId]])
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

test('malformed edits are rejected before any write',async()=>{
 const calls=[]
 await withServer(bridge(writer({calls})),async base=>{
  for(const payload of [{...body,title:''},{...body,title:'   '},{...body,title:'x'.repeat(161)},{...body,objective:'x'.repeat(4001)},
   {...body,title:'api_key=abc'},{...body,expectedVersion:0},{...body,status:'ready'},{projectId:project,title:'t'},[],'not json'])
   assert.equal((await post(base,payload)).status,400,JSON.stringify(payload))
  assert.equal((await post(base,body,{path:'/api/work/tasks/'+taskId+'/edit?x=1'})).status,400)
  assert.equal((await post(base,body,{path:'/api/work/tasks/not-a-uuid/edit'})).status,404)
  assert.equal((await post(base,body,{headers:{'content-type':'text/plain'}})).status,415)
  assert.equal((await post(base,body,{headers:{'sec-fetch-site':'cross-site'}})).status,403)
 })
 assert.equal(calls.length,0)
})

test('a changed task is 409, a closed task 409 and storage failures are sanitized',async()=>{
 const failing=code=>writer({edit:async()=>{const e=Error('db password SECRET');e.code=code;throw e}})
 for(const [code,status,error] of [['conflict',409,'work-task-changed'],['closed',409,'work-task-closed'],
  ['invalid',400,'invalid-work-task-edit'],['denied',403,'work-write-denied'],[undefined,503,'work-write-unavailable']]){
  await withServer(bridge(failing(code)),async base=>{
   const response=await post(base)
   assert.equal(response.status,status)
   assert.deepEqual(await response.json(),{error})
  })
 }
 for(const reply of [{...edited,id:'00000000-0000-4000-8000-000000000000'},{...edited,title:'Other'}])
  await withServer(bridge(writer({edit:async()=>reply})),async base=>{ assert.equal((await post(base)).status,503) })
})
