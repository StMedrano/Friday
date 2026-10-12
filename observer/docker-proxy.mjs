import http from 'node:http'
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const FULL_ID='[a-fA-F0-9]{64}'
const INSPECT=new RegExp('^/containers/'+FULL_ID+'/json$')
// The broker never releases raw container logs. Logs can contain arbitrarily
// formatted credentials that cannot be reliably scrubbed by regex.
const COMPOSE_LABEL_KEYS=['com.docker.compose.project','com.docker.compose.service']
const safeText=(x,max=256)=>typeof x==='string'?x.slice(0,max):''
const safeNumber=(x)=>Number.isSafeInteger(x)&&x>=0?x:null
function composeLabels(value){
 const result={}
 for(const key of COMPOSE_LABEL_KEYS){
  if(typeof value?.[key]==='string')result[key]=value[key].slice(0,256)
 }
 return result
}
function safePorts(input){
 if(!Array.isArray(input))return []
 return input.slice(0,128).filter(x=>x&&typeof x==='object').map(p=>({
  PrivatePort:safeNumber(p.PrivatePort), PublicPort:safeNumber(p.PublicPort),
  Type:safeText(p.Type,12), IP:safeText(p.IP,50),
 }))
}
function projectedContainerList(body){
 if(!Array.isArray(body)||body.length>5000)throw Error('docker-container-list-invalid')
 return body.map(x=>({
  Id:safeText(x?.Id,64),
  Names:Array.isArray(x?.Names)?x.Names.slice(0,8).map(n=>safeText(n,256)):[],
  Image:safeText(x?.Image),
  State:safeText(x?.State,32),
  Status:safeText(x?.Status,160),
  Ports:safePorts(x?.Ports),
  Labels:composeLabels(x?.Labels),
 }))
}
function projectedInspect(x){
 if(!x||typeof x!=='object'||Array.isArray(x))throw Error('docker-inspect-invalid')
 const health=x.State?.Health
 const restart=x.HostConfig?.RestartPolicy
 const ports={}
 for(const [k,v] of Object.entries(x.NetworkSettings?.Ports||{}).slice(0,128)){
  if(!/^[0-9]{1,5}\/(tcp|udp|sctp)$/.test(k))continue
  ports[k]=Array.isArray(v)?v.slice(0,20).map(b=>({
   HostIp:safeText(b?.HostIp,50),HostPort:safeText(b?.HostPort,12),
  })):null
 }
 const networks={}
 for(const name of Object.keys(x.NetworkSettings?.Networks||{}).slice(0,128))networks[safeText(name,128)]={}
 return {
  Id:safeText(x.Id,64),Name:safeText(x.Name),
  Image:safeText(x.Image),
  Config:{Image:safeText(x.Config?.Image),Labels:composeLabels(x.Config?.Labels)},
  State:{
   Status:safeText(x.State?.Status,32),ExitCode:safeNumber(x.State?.ExitCode),
   OOMKilled:x.State?.OOMKilled===true,
   StartedAt:safeText(x.State?.StartedAt,64),
   FinishedAt:safeText(x.State?.FinishedAt,64),
   Health:health?{
    Status:safeText(health.Status,32),
    Log:Array.isArray(health.Log)?health.Log.slice(-3).map(h=>({
     Start:safeText(h?.Start,64),End:safeText(h?.End,64),
     ExitCode:safeNumber(h?.ExitCode),
    })):[]
   }:null,
  },
  RestartCount:safeNumber(x.RestartCount),
  HostConfig:{RestartPolicy:{
   Name:safeText(restart?.Name,40),
   MaximumRetryCount:safeNumber(restart?.MaximumRetryCount),
  }},
  NetworkSettings:{Ports:ports,Networks:networks},
 }
}
export function allowedDockerRead(method,path) {
 if(method!=='GET'||typeof path!=='string'||path.length>240)return false
 return path==='/containers/json?all=1'||INSPECT.test(path)
}
function redactDockerResult(path,bytes){
 const body=JSON.parse(bytes.toString('utf8'))
 return Buffer.from(JSON.stringify(
  path==='/containers/json?all=1'?projectedContainerList(body):projectedInspect(body)
 ))
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
    const limit=2*1024*1024
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
     try {
      const result=redactDockerResult(path,Buffer.concat(chunks))
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'})
      res.end(result)
     }catch{
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'})
      res.end('{"error":"docker-upstream-unavailable"}')
     }
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
