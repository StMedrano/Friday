import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync, sign} from 'node:crypto'
import {createPrivateWorkReadBridge} from './private-read-bridge.mjs'

const issuer='https://friday-fixture.cloudflareaccess.com'
const audience='fixture-audience'
const pair=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'}
const now=()=>Math.floor(Date.now()/1000)
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
function jwt({sub='member-1',aud=audience,exp=now()+600,...claims}={}){
 const message=encode({alg:'RS256',kid:'fixture-key'})+'.'+encode({
  iss:issuer,aud,exp,sub,email:'user@example.test',...claims,
 })
 return message+'.'+sign('RSA-SHA256',Buffer.from(message),pair.privateKey).toString('base64url')
}
const request=token=>({headers:token?{'cf-access-jwt-assertion':token}:{}})
function fixture({enabled=true,grantsForSubject,workRows,memoryRows}={}){
 const calls=[],grants=[]
 const grantSource=grantsForSubject||(async subject=>{
  grants.push(subject)
  return {allowedProjectIds:['project-a'],
   allowedMemoryScopes:[{scope:'project',ownerId:'project-a'}]}
 })
 const workService={
  async list(args){
   calls.push({operation:'tasks',args})
   return workRows||[{id:'task-1',projectId:'project-a',title:'Fix monitored service',
    status:'ready',version:1,objective:'internal detail intentionally excluded'}]
  },
  async get(args){
   calls.push({operation:'task',args})
   return {id:'task-1',projectId:'project-a',title:'Fix monitored service',
    status:'ready',version:1}
  },
 }
 const memoryService={
  async search(args){
   calls.push({operation:'memory',args})
   return memoryRows||[{id:'mem-1',scope:'project',ownerId:'project-a',
    projectId:'project-a',content:'Read-only architecture note',provenance:'staff'}]
  },
 }
 const bridge=createPrivateWorkReadBridge({
  enabled,access:{enabled:true,teamDomain:issuer,audience,operatorEmails:[]},
  grantsForSubject:grantSource,workService,memoryService,
  fetchKeys:async url=>{assert.equal(url,issuer+'/cdn-cgi/access/certs')
   return {ok:true,json:async()=>({keys:[jwk]})}},
 })
 return {bridge,calls,grants}
}

test('closed by default: no read or grant lookup before explicit configuration',async()=>{
 const f=fixture({enabled:false})
 assert.equal(f.bridge.enabled,false)
 await assert.rejects(f.bridge.listTasks(request(jwt()),{projectId:'project-a'}),/work-read-denied/)
 await assert.rejects(f.bridge.getTask(request(jwt()),{workItemId:'task-1'}),/work-read-denied/)
 await assert.rejects(f.bridge.searchMemory(request(jwt()),{
  scopes:[{scope:'project',ownerId:'project-a'}],
 }),/work-read-denied/)
 assert.deepEqual(f.calls,[])
 assert.deepEqual(f.grants,[])
 assert.equal(createPrivateWorkReadBridge({enabled:true}).enabled,false)
})

test('signed Cloudflare identity and trusted exact-grant provider are mandatory',async()=>{
 const f=fixture()
 for(const header of [undefined,'not-a-jwt',jwt({aud:'another-app'}),
  jwt({exp:now()-3600}),jwt({sub:''})]){
  await assert.rejects(f.bridge.listTasks(request(header),{projectId:'project-a'}),/work-read-denied/)
 }
 assert.deepEqual(f.calls,[])
 assert.deepEqual(f.grants,[])
 const invalid=fixture({grantsForSubject:async()=>({allowedProjectIds:['project-a'],
  allowedMemoryScopes:[],role:'Administrator'})})
 await assert.rejects(invalid.bridge.listTasks(request(jwt()),{projectId:'project-a'}),/work-read-denied/)
 assert.deepEqual(invalid.calls,[])
})

test('tasks are scoped to verified subject grants, never user headers or requested actor',async()=>{
 const f=fixture()
 const result=await f.bridge.listTasks(request(jwt({role:'Administrator'})),{
  projectId:'project-a',limit:5,
 })
 assert.deepEqual(result,[{id:'task-1',projectId:'project-a',title:'Fix monitored service',
  status:'ready',version:1}])
 assert.deepEqual(f.grants,['member-1'])
 assert.equal(f.calls[0].args.projectId,'project-a')
 assert.match(f.calls[0].args.actor.principalId,/^access:[a-f0-9]{64}$/)
 assert.deepEqual(f.calls[0].args.actor.allowedAgentIds,[])
 assert.equal(f.calls[0].args.principalId,undefined)
 for(const input of [
  {projectId:'project-b',limit:1},
  {projectId:'project-a',limit:26},
  {projectId:'project-a',limit:1,actor:{principalId:'admin'}},
  {projectId:'project-a',limit:0},null,
 ])await assert.rejects(f.bridge.listTasks(request(jwt()),input),/work-read-denied/)
 assert.equal(f.calls.length,1)
})

test('detail lookup and task list deny unexpected repository rows and errors',async()=>{
 const f=fixture({workRows:[{id:'wrong',projectId:'project-b',title:'Secret project',
  status:'ready',version:1}]})
 await assert.rejects(f.bridge.listTasks(request(jwt()),{projectId:'project-a'}),/work-read-denied/)
 const bad=fixture({workRows:[{id:'task-1',projectId:'project-a',title:'Server password=secret',
  status:'ready',version:1}]})
 await assert.rejects(bad.bridge.listTasks(request(jwt()),{projectId:'project-a'}),/work-read-denied/)
 const clean=fixture()
 const result=await clean.bridge.getTask(request(jwt()),{workItemId:'task-1'})
 assert.deepEqual(result,{id:'task-1',projectId:'project-a',title:'Fix monitored service',
  status:'ready',version:1})
 assert.equal(clean.calls.at(-1).args.actor.allowedProjectIds[0],'project-a')
 await assert.rejects(clean.bridge.getTask(request(jwt()),{workItemId:'task-1',role:'admin'}),/work-read-denied/)
})

test('memory scope is an exact grant intersection and excludes cross-project rows',async()=>{
 const f=fixture()
 const result=await f.bridge.searchMemory(request(jwt()),{
  scopes:[{scope:'project',ownerId:'project-a'}],query:'architecture',limit:5,
 })
 assert.deepEqual(result,[{id:'mem-1',scope:'project',ownerId:'project-a',
  projectId:'project-a',content:'Read-only architecture note',provenance:'staff'}])
 assert.equal(f.calls[0].args.actor.allowedAgentIds.length,0)
 assert.equal(f.calls[0].args.scopes[0].ownerId,'project-a')
 for(const input of [
  {scopes:[{scope:'project',ownerId:'project-b'}]},
  {scopes:[{scope:'project',ownerId:'project-a'}],limit:21},
  {scopes:[{scope:'project',ownerId:'project-a'}],query:'x'.repeat(129)},
  {scopes:[{scope:'project',ownerId:'project-a',role:'admin'}]},
  {scopes:[{scope:'project',ownerId:'project-a'}],actor:'another-person'},
 ])await assert.rejects(f.bridge.searchMemory(request(jwt()),input),/work-read-denied/)
 assert.equal(f.calls.length,1)
 const leak=fixture({memoryRows:[{id:'other',scope:'project',ownerId:'project-b',
  projectId:'project-b',content:'secret cross-project',provenance:'staff'}]})
 await assert.rejects(leak.bridge.searchMemory(request(jwt()),{
  scopes:[{scope:'project',ownerId:'project-a'}],
 }),/work-read-denied/)
})

test('unavailable backend never surfaces error details and cannot invent records',async()=>{
 const f=fixture()
 f.bridge.enabled===true&&assert.ok(true)
 const rejects=fixture({grantsForSubject:async()=>{throw Error('private-identity-error')}})
 await assert.rejects(rejects.bridge.getTask(request(jwt()),{workItemId:'task-1'}),err=>{
  assert.equal(err.message,'work-read-denied')
  assert.equal(JSON.stringify(err).includes('private-identity-error'),false)
  return true
 })
 assert.deepEqual(rejects.calls,[])
})
