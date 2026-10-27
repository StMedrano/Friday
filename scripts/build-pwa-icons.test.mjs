import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inflateSync} from 'node:zlib'
import {createFridayPng,writeFridayPwaIcons} from './build-pwa-icons.mjs'

test('PWA launcher icons are valid opaque RGB PNG at Chromium required sizes',()=>{
 for(const size of [192,512]){
  const png=createFridayPng(size)
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10])
  assert.equal(png.readUInt32BE(16),size)
  assert.equal(png.readUInt32BE(20),size)
  assert.equal(png[25],2) // 8-bit RGB, no transparent edges
  const chunks=[]
  for(let p=8;p<png.length;){
   const n=png.readUInt32BE(p);const kind=png.toString('ascii',p+4,p+8)
   if(kind==='IDAT')chunks.push(png.subarray(p+8,p+8+n))
   p+=n+12
  }
  const raw=inflateSync(Buffer.concat(chunks))
  assert.equal(raw.length,size*(1+size*3))
  assert.ok(new Set(raw.subarray(1,90)).size>1)
 }
})
test('launcher icons are materialized into dist only; never mutate source/public',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'friday-pwa-icons-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 await writeFridayPwaIcons(dir)
 for(const size of [192,512]){
  const bytes=await readFile(join(dir,'icons',`friday-${size}.png`))
  assert.equal(bytes.readUInt32BE(16),size)
 }
})
