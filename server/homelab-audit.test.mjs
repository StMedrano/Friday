import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, chmod, rm, symlink, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createHomeLabAudit} from './homelab-audit.mjs'

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'friday-audit-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const directory=join(root,'audit')
 const store=await createHomeLabAudit({directory})
 const record={requestId:randomUUID(),event:'restart-requested',actor:'a'.repeat(64),target:'staging-canary',at:1000,expiresAt:2000}
 return {root,directory,store,record}
}

test('audit persists exact structured records with private modes and rejects overwriting',async t=>{
 const {directory,store,record}=await fixture(t)
 await store.append(record)
 const file=join(directory,record.requestId+'.'+record.event+'.json')
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),record)
 assert.equal((await stat(directory)).mode&0o777,0o700)
 assert.equal((await stat(file)).mode&0o777,0o600)
 await assert.rejects(store.append({...record,actor:'b'.repeat(64)}))
 const reloaded=await createHomeLabAudit({directory})
 assert.deepEqual(await reloaded.read(record.requestId,record.event),record)
 assert.equal(await reloaded.read(randomUUID(),record.event),null)
})

test('invalid records, paths and permissive directory fail closed',async t=>{
 const {directory,store,record}=await fixture(t)
 for(const invalid of [{...record,raw:'private'},{...record,target:'production'},{...record,actor:'raw email'},
  {...record,requestId:'../../escape'},{...record,event:'execute'},{...record,at:NaN}]) {
  await assert.rejects(store.append(invalid),/homelab-denied/)
 }
 await assert.rejects(store.read('../escape','restart-requested'),/homelab-denied/)
 await chmod(directory,0o755)
 await assert.rejects(store.append(record),/homelab-denied/)
 await assert.rejects(createHomeLabAudit({directory}),/homelab-denied/)
})

test('symbolic-link event and directory cannot redirect audit reads or writes',async t=>{
 const {root,directory,store,record}=await fixture(t)
 const outside=join(root,'outside')
 const alias=join(root,'alias')
 await symlink(directory,alias)
 await assert.rejects(createHomeLabAudit({directory:alias}),/homelab-denied/)
 const event=join(directory,record.requestId+'.'+record.event+'.json')
 await symlink(outside,event)
 await assert.rejects(store.append(record))
 await assert.rejects(store.read(record.requestId,record.event))
})
