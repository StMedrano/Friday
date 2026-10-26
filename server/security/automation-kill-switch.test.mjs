import test from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdtemp, rm, symlink, writeFile, rename, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileAutomationGate} from './automation-kill-switch.mjs'

const TIME=1793034000000
const record=(state='allow-approved-actions',expiresAt=TIME+120000)=>
 JSON.stringify({schemaVersion:1,state,expiresAt})+'\n'

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'friday-action-gate-'))
 const directory=join(root,'private')
 await mkdir(directory,{mode:0o700})
 const filePath=join(directory,'control.json')
 t.after(()=>rm(root,{recursive:true,force:true}))
 let time=TIME
 return {root,directory,filePath,clock:()=>time,setTime:value=>{time=value},
  gate:createFileAutomationGate({filePath,now:()=>time})}
}

test('missing and invalid configuration fail closed, never create an enable file',async t=>{
 const f=await fixture(t)
 assert.equal(createFileAutomationGate().isAllowed(),false)
 assert.equal(createFileAutomationGate({filePath:'relative.json'}).isAllowed(),false)
 assert.equal(f.gate.isAllowed(),false)
 await assert.rejects(import('node:fs/promises').then(fs=>fs.stat(f.filePath)),{code:'ENOENT'})
})

test('trusted owner-only file arms only a short-lived bounded window, rechecked every time',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,record(),{mode:0o600})
 assert.equal(f.gate.isAllowed(),true)
 f.setTime(TIME+120000)
 assert.equal(f.gate.isAllowed(),false)
 f.setTime(TIME)
 await writeFile(f.filePath,record('stopped'))
 assert.equal(f.gate.isAllowed(),false)
 await writeFile(f.filePath,record())
 assert.equal(f.gate.isAllowed(),true)
 await rm(f.filePath)
 assert.equal(f.gate.isAllowed(),false)
})

test('rejects stale, far-future, malformed, non-exact and oversized state',async t=>{
 const f=await fixture(t)
 const examples=[
  record('allow-approved-actions',TIME-1),
  record('allow-approved-actions',TIME+3600000),
  record('enabled',TIME+10000),
  '{"schemaVersion":1,"state":"allow-approved-actions","expiresAt":"soon"}',
  '{"schemaVersion":2,"state":"allow-approved-actions","expiresAt":1793034010000}',
  '{"schemaVersion":1,"state":"allow-approved-actions","expiresAt":1793034010000,"grant":"all"}',
  'not-json',
  'x'.repeat(700),
 ]
 for(const bad of examples){
  await writeFile(f.filePath,bad,{mode:0o600})
  assert.equal(f.gate.isAllowed(),false)
 }
})

test('rejects permissive owner file and parent directory, symlinks, directories and broken target',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,record(),{mode:0o600})
 assert.equal(f.gate.isAllowed(),true)
 await chmod(f.filePath,0o644)
 assert.equal(f.gate.isAllowed(),false)
 await chmod(f.filePath,0o600)
 await chmod(f.directory,0o755)
 assert.equal(f.gate.isAllowed(),false)
 await chmod(f.directory,0o700)
 await rm(f.filePath)
 const outside=join(f.root,'outside.json')
 await writeFile(outside,record(),{mode:0o600})
 await symlink(outside,f.filePath)
 assert.equal(f.gate.isAllowed(),false)
 await rm(f.filePath)
 const alias=join(f.root,'alias')
 await symlink(f.directory,alias)
 assert.equal(createFileAutomationGate({filePath:join(alias,'outside.json'),now:()=>TIME}).isAllowed(),false)
 await mkdir(f.filePath)
 assert.equal(f.gate.isAllowed(),false)
})

test('replacement file is evaluated immediately, including a denied state after prior allow',async t=>{
 const f=await fixture(t)
 await writeFile(f.filePath,record(),{mode:0o600})
 assert.equal(f.gate.isAllowed(),true)
 const update=join(f.directory,'next.json')
 await writeFile(update,record('stopped'),{mode:0o600})
 await rename(update,f.filePath)
 assert.equal(f.gate.isAllowed(),false)
})
