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

test('pending queue survives reload, omits approved and expired, and orders by expiry',async t=>{
 const {directory,store,record}=await fixture(t)
 const first={...record,requestId:randomUUID(),expiresAt:3000}
 const next={...record,requestId:randomUUID(),expiresAt:5000}
 const expired={...record,requestId:randomUUID(),expiresAt:1200}
 for(const row of [next,expired,first])await store.append(row)
 const reloaded=await createHomeLabAudit({directory})
 const available=await reloaded.listPending({at:1500,limit:20})
 assert.deepEqual(available.map(r=>r.requestId),[first.requestId,next.requestId])
 assert.equal(available[0].actor,record.actor)
 await store.append({...first,event:'restart-approved',actor:'b'.repeat(64),at:1600})
 assert.deepEqual((await reloaded.listPending({at:1500,limit:20})).map(r=>r.requestId),[next.requestId])
 assert.deepEqual(await reloaded.listPending({at:6000,limit:20}),[])
})

test('pending queue enforces bounded input and no partial results on corrupt records or symlinks',async t=>{
 const {directory,store,record}=await fixture(t)
 await store.append(record)
 for(const bad of [{at:-1,limit:20},{at:1500,limit:0},{at:1500,limit:51},{at:NaN,limit:20}]){
  await assert.rejects(store.listPending(bad),/homelab-denied/)
 }
 assert.equal((await store.listPending({at:1500,limit:1})).length,1)
 const path=join(directory,record.requestId+'.restart-requested.json')
 await writeFile(path,'{bad')
 await assert.rejects(store.listPending({at:1500,limit:20}),/homelab-denied/)
 await writeFile(path,JSON.stringify(record))
 await chmod(path,0o644)
 await assert.rejects(store.listPending({at:1500,limit:20}),/homelab-denied/)
 await chmod(path,0o600)
 await writeFile(join(directory,'junk.restart-requested.json'),'not safe')
 await assert.rejects(store.listPending({at:1500,limit:20}),/homelab-denied/)
})

test('pending queue cannot follow symlinked event or produce partial results on invalid approval',async t=>{
 const {directory,store,record}=await fixture(t)
 const second={...record,requestId:randomUUID()}
 await store.append(record)
 await store.append(second)
 const approval=join(directory,record.requestId+'.restart-approved.json')
 await symlink(join(directory,second.requestId+'.restart-requested.json'),approval)
 await assert.rejects(store.listPending({at:1500,limit:20}),/homelab-denied/)
})

test('pending queue fails closed when private audit directory exceeds bounded scan',async t=>{
 const {directory,store}=await fixture(t)
 for(let i=0;i<515;i++){
  await writeFile(join(directory,randomUUID()+'.denied.json'),'{}',{mode:0o600})
 }
 await assert.rejects(store.listPending({at:1500,limit:1}),/homelab-denied/)
})

test('queue fails closed on orphan approvals and forged overlong proposal TTL',async t=>{
 const {store,record}=await fixture(t)
 await store.append({...record,event:'restart-approved',actor:'b'.repeat(64)})
 await assert.rejects(store.listPending({at:1500,limit:20}),/homelab-denied/)
})

test('queue never returns a partial slice when a later proposal has an unsafe TTL',async t=>{
 const {store,record}=await fixture(t)
 await store.append(record)
 const forged={...record,requestId:randomUUID(),expiresAt:record.at+86400000}
 await store.append(forged)
 await assert.rejects(store.listPending({at:1500,limit:1}),/homelab-denied/)
})
