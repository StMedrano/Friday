import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp,writeFile,readFile,rm,mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createWebGrowthReader } from '../integrations/web-growth-reader/server.mjs'
const token='synthetic-fixture-token-1234567890123456'
const sourceRevision='abcdef0'
const store={version:1,leads:[]}
async function serve(t,options) {
 const server=createWebGrowthReader({token,sourceRevision,...options})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(()=>new Promise(resolve=>server.close(resolve)))
 return (path='/v1/friday/web-growth',options={})=>fetch('http://127.0.0.1:'+server.address().port+path,options)
}
test('authentication and fixed GET route deny before any reads',async t=>{
 let reads=0
 const request=await serve(t,{readStoreImpl:async()=>{reads++;return Buffer.from(JSON.stringify(store))}})
 for(const authorization of [undefined,'Bearer wrong']) assert.equal((await request(undefined,{headers:authorization?{authorization}:{}})).status,401)
 for(const method of ['POST','PUT','DELETE','HEAD']) assert.equal((await request(undefined,{method,headers:{authorization:'Bearer '+token}})).status,405)
 assert.equal((await request('/other',{headers:{authorization:'Bearer '+token}})).status,404)
 assert.equal((await request('/v1/friday/web-growth?file=/etc/passwd',{headers:{authorization:'Bearer '+token}})).status,404)
 assert.equal(reads,0)
 const response=await request(undefined,{headers:{authorization:'Bearer '+token}})
 assert.equal(response.status,200);assert.equal((await response.json()).projectId,'techtactics-web-growth')
 assert.equal(reads,1)
})
test('regular source remains byte-identical and checksum is exact; missing/malformed/oversize are unavailable',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'friday-reader-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'leads.json')
 const bytes=Buffer.from(JSON.stringify(store)+'\n');await writeFile(file,bytes)
 const request=await serve(t,{filePath:file})
 const options={headers:{authorization:'Bearer '+token}}
 const snapshot=await (await request(undefined,options)).json()
 assert.equal(snapshot.sourceChecksum,createHash('sha256').update(bytes).digest('hex'))
 assert.deepEqual(await readFile(file),bytes)
 for(const invalid of ['{','{"version":2,"leads":[]}', ' '.repeat(8*1024*1024+1)]) {
  await writeFile(file,invalid)
  const response=await request(undefined,options);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'web-growth-unavailable'})
 }
 await rm(file);assert.equal((await request(undefined,options)).status,503)
 await mkdir(file);assert.equal((await request(undefined,options)).status,503)
})
test('configuration fails closed',()=>{
 for(const bad of ['', 'short', ' '.repeat(40),'x'.repeat(32)+' ']) assert.throws(()=>createWebGrowthReader({token:bad,sourceRevision}))
 assert.throws(()=>createWebGrowthReader({token,sourceRevision:'bad-revision'}))
})
