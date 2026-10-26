import test from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileOperatorRolePolicy} from './file-operator-policy.mjs'

const NOW=1793034000000
const MAX_AGE=24*60*60*1000
const operator={subject:'operator-sub',email:'user@example.test'}
const admin={subject:'admin-sub',email:'admin@example.test'}
const bindings=[
 {subject:'operator-sub',role:'Operator',targets:['staging-canary']},
 {subject:'admin-sub',role:'Administrator',targets:['staging-canary']},
]
const canonical=(b=bindings,expiresAt=NOW+60*60*1000)=>
 JSON.stringify({schemaVersion:1,expiresAt,bindings:b})+'\n'

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'friday-roles-'))
 const directory=join(root,'policy')
 await mkdir(directory,{mode:0o700})
 const filePath=join(directory,'roles.json')
 let time=NOW
 const policy=createFileOperatorRolePolicy({filePath,now:()=>time})
 t.after(()=>rm(root,{force:true,recursive:true}))
 return {root,directory,filePath,policy,setTime:x=>{time=x}}
}

test('unconfigured or missing private bindings deny without creating a policy file',async t=>{
 const f=await fixture(t)
 assert.equal(createFileOperatorRolePolicy().permits(operator,'diagnostics.read','staging-canary'),false)
 assert.equal(createFileOperatorRolePolicy({filePath:'relative.json'}).permits(operator,'diagnostics.read','staging-canary'),false)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 await assert.rejects(readFile(f.filePath),{code:'ENOENT'})
})

test('valid trusted file grants only subject-scoped role actions with no executor capability',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.equal(f.policy.permits(operator,'diagnostics.read','staging-canary'),true)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),true)
 assert.equal(f.policy.permits(operator,'action.approve','staging-canary'),false)
 assert.equal(f.policy.permits(admin,'action.approve','staging-canary'),true)
 assert.equal(f.policy.permits(admin,'action.execute','staging-canary'),false)
 assert.equal(f.policy.permits(admin,'action.approve','production'),false)
 assert.equal(f.policy.permits({subject:'operator-sub',kind:'service'},'action.propose','staging-canary'),false)
 assert.equal(f.policy.permits({email:'user@example.test'},'action.propose','staging-canary'),false)
})

test('policy revocation, role downgrades and expiration take effect on the next authorization check',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),true)
 const update=join(f.directory,'replacement.json')
 await writeFile(update,canonical([{subject:'operator-sub',role:'Viewer',targets:['staging-canary']}]),{mode:0o600})
 await rename(update,f.filePath)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 assert.equal(f.policy.permits(operator,'diagnostics.read','staging-canary'),true)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 f.setTime(NOW+60*60*1000)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 f.setTime(NOW)
 await rm(f.filePath)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
})

test('expired, far-future, malformed, extra-field, duplicate JSON keys and oversized payloads deny',async t=>{
 const f=await fixture(t)
 const cases=[
  canonical(bindings,NOW-1),canonical(bindings,NOW+MAX_AGE+1),
  canonical([{subject:'operator-sub',role:'SuperAdmin',targets:['staging-canary']}]),
  canonical([{subject:'operator-sub',role:'Administrator',targets:['*']}]),
  canonical([{subject:'operator-sub',role:'Operator',targets:['staging-canary'],override:true}]),
  canonical([...bindings,bindings[0]]),
  JSON.stringify({schemaVersion:2,expiresAt:NOW+1000,bindings})+'\n',
  JSON.stringify({schemaVersion:1,expiresAt:NOW+1000,bindings,debug:true})+'\n',
  '{"schemaVersion":1,"expiresAt":1793034001000,"bindings":[],"bindings":'+JSON.stringify(bindings)+'}\n',
  '{"schemaVersion":1,"expiresAt":1793034001000,"bindings":'+JSON.stringify(bindings)+',"schemaVersion":1}\n',
  JSON.stringify({bindings,schemaVersion:1,expiresAt:NOW+1000})+'\n',
  JSON.stringify({schemaVersion:1,expiresAt:NOW+1000,bindings}),
  JSON.stringify({schemaVersion:1,expiresAt:'soon',bindings})+'\n',
  'not-json',
  'x'.repeat(20000),
 ]
 for(const value of cases){
  await writeFile(f.filePath,value,{mode:0o600})
  assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false,value.slice(0,70))
 }
})

test('permissive directories and files, symlinks and directory targets fail closed',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),true)
 await chmod(f.filePath,0o644)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 await chmod(f.filePath,0o600)
 await chmod(f.directory,0o755)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 await chmod(f.directory,0o700)
 await rm(f.filePath)
 const outside=join(f.root,'outside.json')
 await writeFile(outside,canonical(),{mode:0o600})
 await symlink(outside,f.filePath)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
 await rm(f.filePath)
 await writeFile(f.filePath,canonical(),{mode:0o600})
 const alias=join(f.root,'alias')
 await symlink(f.directory,alias)
 assert.equal(createFileOperatorRolePolicy({filePath:join(alias,'roles.json'),now:()=>NOW}).permits(operator,'action.propose','staging-canary'),false)
 await rm(f.filePath)
 await mkdir(f.filePath)
 assert.equal(f.policy.permits(operator,'action.propose','staging-canary'),false)
})
