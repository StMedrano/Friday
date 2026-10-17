import http from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { open, constants } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { projectWebGrowthStore } from '../../server/adapters/web-growth-schema.mjs'
const MAX_BYTES=8*1024*1024
function json(response,status,body) {
 response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'})
 response.end(JSON.stringify(body))
}
async function readBoundedStore(filePath) {
 const handle=await open(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try {
  const info=await handle.stat()
  if(!info.isFile()||info.size>MAX_BYTES) throw new Error('Unavailable')
  // Bound the read even if the file grows after stat.
  const buffer=Buffer.alloc(MAX_BYTES+1)
  let size=0
  while(size<buffer.length) {
   const result=await handle.read(buffer,size,buffer.length-size,size)
   if(result.bytesRead===0) break
   size+=result.bytesRead
  }
  if(size>MAX_BYTES) throw new Error('Unavailable')
  return buffer.subarray(0,size)
 } finally { await handle.close() }
}
export function createWebGrowthReader({token,filePath='/data/leads.json',sourceRevision,readStoreImpl=readBoundedStore}={}) {
 if(typeof token!=='string'||token.length<32||/\s/.test(token)||typeof sourceRevision!=='string'||! /^[a-f0-9]{7,40}$/.test(sourceRevision)) throw new Error('Invalid Web Growth reader configuration')
 const tokenHash=createHash('sha256').update(token).digest()
 return http.createServer(async(request,response)=>{
  if(request.url==='/health'&&request.method==='GET') return json(response,200,{status:'ok'})
  if(request.url!=='/v1/friday/web-growth') return json(response,404,{error:'not-found'})
  if(request.method!=='GET') return json(response,405,{error:'method-not-allowed'})
  const authorization=request.headers.authorization
  const match=typeof authorization==='string'?/^Bearer ([^\s]+)$/.exec(authorization):null
  const providedHash=createHash('sha256').update(match?.[1]??'').digest()
  if(!timingSafeEqual(tokenHash,providedHash)||!match) return json(response,401,{error:'unauthorized'})
  try {
   const bytes=await readStoreImpl(filePath)
   if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES) throw new Error('Unavailable')
   const snapshot=projectWebGrowthStore(JSON.parse(bytes.toString('utf8')),{sourceRevision,sourceChecksum:createHash('sha256').update(bytes).digest('hex'),generatedAt:new Date().toISOString()})
   return json(response,200,snapshot)
  } catch { return json(response,503,{error:'web-growth-unavailable'}) }
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const server=createWebGrowthReader({token:process.env.WEB_GROWTH_READER_TOKEN,sourceRevision:process.env.WEB_GROWTH_READER_REVISION})
  server.listen(4318,'0.0.0.0')
  server.on('error',()=>{process.stderr.write('Web Growth reader unavailable\n');process.exitCode=1})
 } catch { process.stderr.write('Web Growth reader configuration invalid\n');process.exitCode=1 }
}
