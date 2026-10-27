import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {chmod,mkdir,mkdtemp,readFile,rename,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileWorkSubjectGrants,workSubjectHash,createTrustedWorkReadBridge} from './file-subject-grants.mjs'

const NOW=1793100000000
const issuer='https://friday-fixture.cloudflareaccess.com'
const audience='friday-human-ui'
const keys=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'work-test-key',alg:'RS256',use:'sig'}
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
function signed({sub='human-subject-1',aud=audience,email='first@example.test',role='Viewer'}={}){
 const body=encode({alg:'RS256',kid:'work-test-key'})+'.'+encode({
  iss:issuer,aud,sub,exp:Math.floor(Date.now()/1000)+600,email,role,
 })
 return body+'.'+sign('RSA-SHA256',Buffer.from(body),keys.privateKey).toString('base64url')
}
const request=claims=>({headers:{'cf-access-jwt-assertion':signed(claims)}})
const binding=(sub='human-subject-1',project='project-a')=>({
 subjectHash:workSubjectHash(sub),
 allowedProjectIds:[project],
 allowedMemoryScopes:[{scope:'project',ownerId:project}],
})
const canonical=(users=[binding()],expiresAt=NOW+3600_000)=>
 JSON.stringify({schemaVersion:1,expiresAt,users})+'\n'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'friday-work-users-'))
 const directory=join(root,'owner-only')
 await mkdir(directory,{mode:0o700})
 const filePath=join(directory,'work-users.json')
 let time=NOW
 t.after(()=>rm(root,{recursive:true,force:true}))
 const grantSource=createFileWorkSubjectGrants({filePath,now:()=>time})
 const calls=[]
 const bridge=createTrustedWorkReadBridge({
  enabled:true,grantFilePath:filePath,now:()=>time,
  access:{enabled:true,teamDomain:issuer,audience,operatorEmails:[]},
  fetchKeys:async()=>({ok:true,json:async()=>({keys:[jwk]})}),
  workService:{
   async list({actor,projectId}){calls.push({actor,projectId})
    return [{id:'task-a',projectId,title:'Read-only acceptance',status:'ready',version:1}]},
   async get({actor,workItemId}){calls.push({actor,workItemId})
    return {id:workItemId,projectId:'project-a',title:'Read-only acceptance',status:'ready',version:1}},
  },
  memoryService:{
   async search({actor,scopes}){calls.push({actor,scopes})
    return [{id:'memory-a',scope:'project',ownerId:'project-a',projectId:'project-a',
     content:'Reviewed design note',provenance:'operator'}]},
  },
 })
 return {root,directory,filePath,grantSource,bridge,calls,
  setTime:value=>{time=value}}
}

test('default-denied file and missing user never invent an authenticated grant',async t=>{
 const f=await fixture(t)
 assert.equal(workSubjectHash('human-subject-1').length,64)
 assert.notEqual(workSubjectHash('human-subject-1'),workSubjectHash('human-subject-2'))
 assert.equal(workSubjectHash(''),null)
 assert.equal(createFileWorkSubjectGrants().enabled,false)
 assert.equal(createTrustedWorkReadBridge({enabled:true}).enabled,false)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
 await assert.rejects(f.bridge.listTasks(request(),{projectId:'project-a'}),/work-read-denied/)
 await assert.rejects(readFile(f.filePath),{code:'ENOENT'})
 await writeFile(f.filePath,canonical(),{mode:0o600})
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-2'),/work-read-denied/)
 await assert.rejects(f.bridge.listTasks(request({sub:'human-subject-2'}),{projectId:'project-a'}),/work-read-denied/)
 assert.deepEqual(f.calls,[])
})

test('genuine signed subject binds exactly a single project and memory scope; email and roles do not grant anything',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.deepEqual(await f.grantSource.grantsForSubject('human-subject-1'),{
  allowedProjectIds:['project-a'],
  allowedMemoryScopes:[{scope:'project',ownerId:'project-a'}],
 })
 assert.deepEqual(await f.bridge.listTasks(request({email:'admin@example.test',role:'Administrator'}),{projectId:'project-a'}),[
  {id:'task-a',projectId:'project-a',title:'Read-only acceptance',status:'ready',version:1},
 ])
 assert.match(f.calls[0].actor.principalId,/^access:[a-f0-9]{64}$/)
 assert.deepEqual(f.calls[0].actor.allowedAgentIds,[])
 assert.deepEqual(await f.bridge.searchMemory(request(),{
  scopes:[{scope:'project',ownerId:'project-a'}],
 }),[{id:'memory-a',scope:'project',ownerId:'project-a',
  projectId:'project-a',content:'Reviewed design note',provenance:'operator'}])
 for(const input of [
  {projectId:'project-b'},
  {projectId:'*'},
  {projectId:'project-a',actor:{role:'Administrator'}},
 ])await assert.rejects(f.bridge.listTasks(request(),input),/work-read-denied/)
 await assert.rejects(f.bridge.listTasks(request({sub:'human-subject-2',email:'first@example.test'}),{
  projectId:'project-a',
 }),/work-read-denied/)
 assert.equal(f.calls.length,2)
})

test('atomic policy replacement and removal revoke user on the very next request without restart',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.equal((await f.bridge.listTasks(request(),{projectId:'project-a'})).length,1)
 const replacement=join(f.directory,'replacement.json')
 await writeFile(replacement,canonical([binding('human-subject-1','project-b')]),{mode:0o600})
 await rename(replacement,f.filePath)
 await assert.rejects(f.bridge.listTasks(request(),{projectId:'project-a'}),/work-read-denied/)
 assert.equal((await f.bridge.listTasks(request(),{projectId:'project-b'})).length,1)
 await writeFile(replacement,canonical([]),{mode:0o600})
 await rename(replacement,f.filePath)
 await assert.rejects(f.bridge.listTasks(request(),{projectId:'project-b'}),/work-read-denied/)
 await rm(f.filePath)
 await assert.rejects(f.bridge.listTasks(request(),{projectId:'project-b'}),/work-read-denied/)
})

test('expiry, overlong validity, duplicate subject and arbitrary authority deny every user',async t=>{
 const f=await fixture(t)
 const b=binding()
 const cases=[
  canonical([b],NOW-1),
  canonical([b],NOW+24*3600_000+1),
  canonical([b,b]),
  canonical([{...b,role:'Administrator'}]),
  canonical([{...b,allowedProjectIds:['*']}]),
  canonical([{...b,allowedProjectIds:['project-a','project-a']}]),
  canonical([{...b,allowedMemoryScopes:[{scope:'global',ownerId:'all'}]}]),
  canonical([{...b,allowedMemoryScopes:[{scope:'project',ownerId:'project-other'}]}]),
  canonical([{...b,subjectHash:'not-sha256'}]),
  canonical([{...b,allowedMemoryScopes:[
   {scope:'project',ownerId:'project-a'},{scope:'project',ownerId:'project-a'}]}]),
  JSON.stringify({schemaVersion:1,expiresAt:NOW+1000,users:[b],extra:'admin'})+'\n',
  JSON.stringify({expiresAt:NOW+1000,schemaVersion:1,users:[b]})+'\n',
  JSON.stringify({schemaVersion:1,expiresAt:NOW+1000,users:[b]}),
  '{"schemaVersion":1,"expiresAt":'+(NOW+1000)+',"users":[],"users":'+JSON.stringify([b])+'}\n',
  '{"schemaVersion":1,"expiresAt":'+(NOW+1000)+',"users":[],"\\u0075sers":'+JSON.stringify([b])+'}\n',
  'x'.repeat(17000),
 ]
 for(const value of cases){
  await writeFile(f.filePath,value,{mode:0o600})
  await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
 }
 await writeFile(f.filePath,canonical(),{mode:0o600})
 f.setTime(NOW+3600_000)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
})

test('non-private mode, symlink, nested alias and invalid file target deny',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.equal((await f.grantSource.grantsForSubject('human-subject-1')).allowedProjectIds[0],'project-a')
 await chmod(f.filePath,0o644)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
 await chmod(f.filePath,0o600)
 await chmod(f.directory,0o755)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
 await chmod(f.directory,0o700)
 const outside=join(f.root,'outside.json')
 await writeFile(outside,canonical(),{mode:0o600})
 await rm(f.filePath)
 await symlink(outside,f.filePath)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
 const alias=join(f.root,'redirected')
 await symlink(f.directory,alias)
 await assert.rejects(createFileWorkSubjectGrants({
  filePath:join(alias,'work-users.json'),now:()=>NOW,
 }).grantsForSubject('human-subject-1'),/work-read-denied/)
 await rm(f.filePath)
 await mkdir(f.filePath)
 await assert.rejects(f.grantSource.grantsForSubject('human-subject-1'),/work-read-denied/)
})
