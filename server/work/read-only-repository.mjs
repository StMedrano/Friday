// Server-only, GET-only PostgREST read repository for the dormant signed
// Friday Phase 2B work browser. Its token must be provisioned separately as
// a SELECT-limited database credential after RLS/role review. NEVER reuse
// the writable service-role token when activating public Tasks/Memory reads.

const DENY=()=>{throw Error('work-read-storage-denied')}
const ORIGIN='https://supabase.mytechtactics.com'
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const TASK_FIELDS=['id','project_id','title','status','version']
const MEMORY_FIELDS=['id','scope','owner_id','project_id','content','provenance']
const STATUSES=new Set(['ready','in_progress','blocked','review','completed','cancelled'])
const FORBIDDEN=/(-----BEGIN [\w ]*PRIVATE KEY-----|authorization\s*[:=]|bearer\s+[\w.-]{6,}|[\w]*(?:api_key|secret|password|token)[\w]*\s*=|sk-[\w-]{8,})/i

function exact(row,fields){
 return row!==null&&typeof row==='object'&&!Array.isArray(row)&&
  Object.keys(row).length===fields.length&&fields.every(k=>Object.hasOwn(row,k))
}
const id=value=>typeof value==='string'&&IDENTIFIER.test(value)
const clean=(s,max)=>typeof s==='string'&&s.trim()===s&&
 s.length>=1&&s.length<=max&&!FORBIDDEN.test(s)
const validTask=r=>exact(r,TASK_FIELDS)&&id(r.id)&&id(r.project_id)&&
 clean(r.title,160)&&STATUSES.has(r.status)&&Number.isSafeInteger(r.version)&&r.version>=1
const validMemory=r=>exact(r,MEMORY_FIELDS)&&id(r.id)&&r.scope==='project'&&
 id(r.owner_id)&&r.owner_id===r.project_id&&clean(r.content,4000)&&
 clean(r.provenance,500)
const toTask=r=>({id:r.id,projectId:r.project_id,title:r.title,
 status:r.status,version:r.version})
const toMemory=r=>({id:r.id,scope:r.scope,ownerId:r.owner_id,
 projectId:r.project_id,content:r.content,provenance:r.provenance})
function validBaseUrl(v){
 try{
  const url=new URL(v)
  return url.origin===ORIGIN&&url.protocol==='https:'&&
   !url.username&&!url.password&&!url.search&&!url.hash&&
   (url.pathname==='/'||url.pathname==='')&&url.port===''
 }catch{return false}
}
function encode(value){return encodeURIComponent(value)}

/**
 * No arbitrary URL, external host, write verb, RPC or raw row projection.
 * Even a buggy injected caller cannot change the SELECT list or query filter.
 * The private human/JWT/project-grant bridge performs *additional* checks.
 */
export function createSupabaseWorkReadRepository({
 baseUrl,readKey,fetchImpl=globalThis.fetch,timeoutMs=5000,
}={}){
 const ready=validBaseUrl(baseUrl)&&typeof readKey==='string'&&
  readKey.length>0&&typeof fetchImpl==='function'&&
  Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=15000
 async function request(path,maxCount,validator,projectId,bytes){
  if(!ready)DENY()
  let response,raw,rows
  try{
   response=await fetchImpl(ORIGIN+path,{
    method:'GET',redirect:'error',headers:{
     accept:'application/json',apikey:readKey,authorization:'Bearer '+readKey,
    },
    signal:AbortSignal.timeout(timeoutMs),
   })
   if(!response?.ok||response.redirected===true)DENY()
   const n=response.headers?.get?.('content-length')
   if(n!==null&&n!==undefined&&( !/^\d+$/.test(n)||Number(n)>bytes))DENY()
   raw=await response.text()
   if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>bytes)DENY()
   rows=JSON.parse(raw)
  }catch{DENY()}
  if(!Array.isArray(rows)||rows.length>maxCount||
     rows.some(x=>!validator(x)||x.project_id!==projectId))DENY()
  return rows
 }
 const list=async input=>{
  if(!exact(input,['projectId','limit'])||!id(input.projectId)||
     !Number.isSafeInteger(input.limit)||input.limit<1||input.limit>25)DENY()
  const {projectId,limit}=input
  const path='/rest/v1/friday_work_items?project_id=eq.'+encode(projectId)+
   '&select='+encode(TASK_FIELDS.join(','))+
   '&order=created_at.desc&limit='+limit
  return (await request(path,limit,validTask,projectId,65536)).map(toTask)
 }
 const get=async workItemId=>{
  if(!id(workItemId))DENY()
  const path='/rest/v1/friday_work_items?id=eq.'+encode(workItemId)+
   '&select='+encode(TASK_FIELDS.join(','))+'&limit=1'
  // Authorization for an item without an expected project is performed by
  // createWorkService.get and again by the signed private read bridge.
  if(!ready)DENY()
  let response,raw,rows
  try{
   response=await fetchImpl(ORIGIN+path,{
    method:'GET',redirect:'error',headers:{
     accept:'application/json',apikey:readKey,authorization:'Bearer '+readKey,
    },signal:AbortSignal.timeout(timeoutMs),
   })
   if(!response?.ok||response.redirected===true)DENY()
   const n=response.headers?.get?.('content-length')
   if(n!==null&&n!==undefined&&(!/^\d+$/.test(n)||Number(n)>8192))DENY()
   raw=await response.text()
   if(Buffer.byteLength(raw,'utf8')>8192)DENY()
   rows=JSON.parse(raw)
  }catch{DENY()}
  if(!Array.isArray(rows)||rows.length>1||rows.some(x=>!validTask(x)||x.id!==workItemId))DENY()
  return rows.length?toTask(rows[0]):null
 }
 const memorySearch=async input=>{
  if(!exact(input,['scope','ownerId','projectId','limit'])||
     input.scope!=='project'||!id(input.ownerId)||
     input.ownerId!==input.projectId||
     !Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)DENY()
  const {ownerId,projectId,limit}=input
  const path='/rest/v1/friday_memories?scope=eq.project&owner_id=eq.'+encode(ownerId)+
   '&project_id=eq.'+encode(projectId)+
   '&select='+encode(MEMORY_FIELDS.join(','))+
   '&order=created_at.desc&limit='+limit
  const rows=await request(path,limit,validMemory,projectId,512*1024)
  return rows.map(toMemory)
 }
 return Object.freeze({get,list,memorySearch})
}
