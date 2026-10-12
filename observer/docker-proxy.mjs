import http from 'node:http'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const FULL_ID='[a-fA-F0-9]{64}'
const INSPECT=new RegExp('^/containers/'+FULL_ID+'/json$')
const LOGS=new RegExp('^/containers/'+FULL_ID+'/logs\\?stdout=1&stderr=1&timestamps=1&tail=([1-9][0-9]{0,2})$')

export function allowedDockerRead(method,path) {
 if(method!=='GET'||typeof path!=='string'||path.length>240)return false
 if(path==='/containers/json?all=1'||INSPECT.test(path))return true
 const logs=LOGS.exec(path)
 return Boolean(logs&&Number(logs[1])<=200)
}

export function createDockerReadOnlyProxyServer({
 dockerRequestOptions=()=>({socketPath:'/var/run/docker.sock'}),
}={}) {
 return http.createServer((req,res)=>{
  const path=req.url||''
  if(!allowedDockerRead(req.method,path)){
   res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'})
   res.end('{"error":"read-only-docker-route-denied"}')
   return
  }
  let upstream
  try {
   upstream=http.request({...dockerRequestOptions(),path,method:'GET',timeout:4000},incoming=>{
    const limit=path.includes('/logs?')?262144:2*1024*1024
    if(incoming.statusCode!==200){
     incoming.resume()
     res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'})
     res.end('{"error":"docker-upstream-unavailable"}')
     return
    }
    const chunks=[]
    let bytes=0
    incoming.on('data',chunk=>{
     bytes+=chunk.length
     if(bytes>limit){
      incoming.destroy()
      return
     }
     chunks.push(chunk)
    })
    incoming.on('end',()=>{
     if(res.writableEnded)return
     res.writeHead(200,{'content-type':incoming.headers['content-type']||'application/json','cache-control':'no-store'})
     res.end(Buffer.concat(chunks))
    })
    incoming.on('error',()=>rejectUpstream())
   })
   function rejectUpstream(){
    if(res.writableEnded)return
    res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'})
    res.end('{"error":"docker-upstream-unavailable"}')
   }
   upstream.on('timeout',()=>upstream.destroy(new Error('timeout')))
   upstream.on('error',rejectUpstream)
   upstream.end()
  }catch{
   if(!res.writableEnded){res.writeHead(503);res.end()}
  }
 })
}

export async function startDockerProxy({
 listenSocket='/proxy/docker.sock',
 server=createDockerReadOnlyProxyServer(),
}={}){
 await mkdir(dirname(listenSocket),{recursive:true})
 try{
  const existing=await lstat(listenSocket)
  // A non-socket file or symlink is never safe to remove.
  if(!existing.isSocket())throw new Error('Refusing to replace non-socket proxy path')
  await unlink(listenSocket)
 }catch(e){if(e?.code!=='ENOENT')throw e}
 await new Promise((resolve,reject)=>{
  server.once('error',reject)
  server.listen(listenSocket,()=>{
   server.off('error',reject)
   resolve()
  })
 })
 await chmod(listenSocket,0o600)
 return server
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const location=process.env.FRIDAY_DOCKER_PROXY_LISTEN_SOCKET||'/proxy/docker.sock'
 startDockerProxy({listenSocket:location}).catch(e=>{
  process.stderr.write('Failed to start read-only Docker proxy: '+e.message+'\n')
  process.exitCode=1
 })
}
