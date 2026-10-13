import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,chmod,symlink,lstat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {rm} from 'node:fs/promises'
import {createFileActionJournal} from './file-journal.mjs'

const e={event:'requested',requestId:'a'.repeat(32),actionId:'service.restart',target:'vm100:test-worker',actor:'admin@example.test',secret:'PRIVATE-DO-NOT-STORE',prompt:'sudo rm -rf /'}
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'friday-action-journal-'))
 await chmod(dir,0o700)
 try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
test('audit journal persists only strict fields in a private file with fsync',async()=>{
 await fixture(async dir=>{
  const path=join(dir,'audit.jsonl')
  const j=createFileActionJournal({path})
  await Promise.all([j.append(e),j.append({...e,event:'approved'})])
  const data=await readFile(path,'utf8')
  const lines=data.trim().split('\n').map(JSON.parse)
  assert.deepEqual(lines.map(x=>x.event),['requested','approved'])
  assert.deepEqual(Object.keys(lines[0]),['event','requestId','actionId','target','actor'])
  assert.equal(data.includes('PRIVATE-DO-NOT-STORE'),false)
  assert.equal(data.includes('sudo rm'),false)
  assert.equal((await lstat(path)).mode&0o077,0)
 })
})
test('no symlink, publicly readable parent or unsafe audit file accepted',async()=>{
 await fixture(async dir=>{
  const target=join(dir,'real')
  const link=join(dir,'audit.jsonl')
  const j=createFileActionJournal({path:link})
  await symlink(target,link)
  await assert.rejects(j.append(e),/audit-unavailable/)
  await rm(link)
  await chmod(dir,0o755)
  await assert.rejects(j.append(e),/audit-unavailable/)
 })
})
test('invalid or relative journal path refuses initialization',()=>{
 for(const path of ['',undefined,'audit.jsonl','/tmp/'])assert.throws(()=>createFileActionJournal({path}),/audit-unavailable/)
})
