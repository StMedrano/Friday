// Strict read-only HTTP transport for the independently signed, project-scoped
// Phase 2B private bridge. This module never authenticates by itself: the
// injected bridge validates the signed Cloudflare Access human JWT on EVERY
// read, resolves current private grants and checks the returned data.
// Nothing in server/index.mjs constructs or enables this transport yet.

const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TASK=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const error=(status,message)=>({status,body:{error:message}})
const malformed=()=>error(400,'invalid-work-read-request')
const unavailable=()=>error(404,'not-found')
const denied=()=>error(403,'work-read-denied')

function query(url,allowed,required=[]){
 const output=Object.create(null)
 for(const [key,value] of url.searchParams){
  if(!allowed.includes(key)||Object.hasOwn(output,key))return null
  output[key]=value
 }
 if(required.some(key=>!Object.hasOwn(output,key)))return null
 return output
}
function limit(raw,max){
 if(raw===undefined)return max===25?20:20
 if(typeof raw!=='string'||!/^[1-9][0-9]?$/.test(raw))return null
 const parsed=Number(raw)
 return parsed<=max?parsed:null
}
function validProject(value){return typeof value==='string'&&PROJECT.test(value)}
const taskDetail=path=>/^\/api\/work\/tasks\/([^/]+)$/.exec(path)

/**
 * Returning null means this is NOT a work route. All /api/work/* routes
 * are handled here and can never fall through to ordinary file/static APIs.
 * Do not expose a GET-backed mutation or use browser-controlled actor grants.
 */
export async function handleWorkReadHttp({request,url,bridge}={}){
 if(typeof url?.pathname!=='string'||!url.pathname.startsWith('/api/work/'))return null
 if(!bridge?.enabled)return unavailable()
 if(request?.method!=='GET')return unavailable()
 const path=url.pathname
 let op,input
 if(path==='/api/work/tasks'){
  const q=query(url,['projectId','limit'],['projectId'])
  if(!q||!validProject(q.projectId))return malformed()
  const n=limit(q.limit,25)
  if(n===null)return malformed()
  op='listTasks';input={projectId:q.projectId,limit:n}
 }else if(path==='/api/work/memory'){
  const q=query(url,['projectId','q','limit'],['projectId'])
  if(!q||!validProject(q.projectId)||typeof (q.q??'')!=='string'||
    (q.q??'').length>128)return malformed()
  const n=limit(q.limit,20)
  if(n===null)return malformed()
  op='searchMemory';input={scopes:[{scope:'project',ownerId:q.projectId}],
   query:q.q??'',limit:n}
 }else{
  const match=taskDetail(path)
  if(!match||url.searchParams.size!==0||!TASK.test(match[1]))return malformed()
  op='getTask';input={workItemId:match[1]}
 }
 if(typeof bridge[op]!=='function')return unavailable()
 try {
  const result=await bridge[op](request,input)
  const plural=op==='listTasks'?'tasks':op==='searchMemory'?'memories':'task'
  if((plural!=='task'&&!Array.isArray(result))||
     (plural==='task'&&(result===null||typeof result!=='object'||Array.isArray(result))))
    return denied()
  return {status:200,body:{[plural]:result}}
 }catch{return denied()}
}
