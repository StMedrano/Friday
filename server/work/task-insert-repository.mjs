// Server-only, insert-only PostgREST repository for Friday's "New task" path.
// Its key must select the friday_work_writer role
// (supabase/migrations/202611060001_friday_work_writer.sql), which can add a
// task and read tasks back, nothing else. NEVER pass the service key here.

const DENY=()=>{throw Error('work-write-storage-denied')}
const CONFLICT=()=>{const e=Error('work-write-conflict');e.code='conflict';throw e}
const ORIGIN='https://supabase.mytechtactics.com'
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PRINCIPAL=/^access:[a-f0-9]{64}$/
const FINGERPRINT=/^[a-f0-9]{64}$/
const TASK_FIELDS=['id','project_id','title','status','version']
const STATUSES=new Set(['ready','in_progress','blocked','review','completed','cancelled'])
const MAX_BYTES=8192

const exact=(row,fields)=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&
 Object.keys(row).length===fields.length&&fields.every(k=>Object.hasOwn(row,k))
const id=value=>typeof value==='string'&&IDENTIFIER.test(value)
const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>=1&&value.length<=max
const validTask=row=>exact(row,TASK_FIELDS)&&id(row.id)&&id(row.project_id)&&
 text(row.title,160)&&STATUSES.has(row.status)&&Number.isSafeInteger(row.version)&&row.version>=1
const toTask=row=>({id:row.id,projectId:row.project_id,title:row.title,status:row.status,version:row.version})

function validBaseUrl(value){
 try{
  const url=new URL(value)
  return url.origin===ORIGIN&&!url.username&&!url.password&&!url.search&&!url.hash&&
   (url.pathname==='/'||url.pathname==='')
 }catch{return false}
}

/**
 * Fixed host, fixed table, fixed columns. The only write is a single INSERT
 * that is ignored when the same person retries the same request id; a retry
 * with different content is a conflict, never an overwrite.
 */
export function createSupabaseTaskInsertRepository({
 baseUrl,writeKey,gatewayKey='',fetchImpl=globalThis.fetch,timeoutMs=5000,
}={}){
 const ready=validBaseUrl(baseUrl)&&typeof writeKey==='string'&&writeKey.length>0&&
  typeof fetchImpl==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=100&&timeoutMs<=15000
 async function call(path,{method='GET',body,prefer}={}){
  if(!ready)DENY()
  let rows
  try{
   const response=await fetchImpl(ORIGIN+path,{
    method,redirect:'error',headers:{
     accept:'application/json',
     apikey:typeof gatewayKey==='string'&&gatewayKey?gatewayKey:writeKey,
     authorization:'Bearer '+writeKey,
     ...(body===undefined?{}:{'content-type':'application/json'}),
     ...(prefer?{prefer}:{}),
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(timeoutMs),
   })
   if(!response?.ok||response.redirected===true)DENY()
   const raw=await response.text()
   if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)DENY()
   rows=JSON.parse(raw)
  }catch{DENY()}
  if(!Array.isArray(rows)||rows.length>1)DENY()
  return rows
 }
 async function create(input){
  if(!exact(input,['projectId','title','objective','principalId','requestId','inputFingerprint'])||
     !id(input.projectId)||!text(input.title,160)||!text(input.objective,4000)||
     !PRINCIPAL.test(input.principalId)||!id(input.requestId)||
     !FINGERPRINT.test(input.inputFingerprint))DENY()
  const select=encodeURIComponent(TASK_FIELDS.join(','))
  const rows=await call('/rest/v1/friday_work_items?on_conflict=creator_principal,request_id&select='+select,{
   method:'POST',prefer:'resolution=ignore-duplicates,return=representation',
   body:{project_id:input.projectId,title:input.title,objective:input.objective,
    acceptance_criteria:[],creator_principal:input.principalId,
    request_id:input.requestId,input_fingerprint:input.inputFingerprint},
  })
  if(rows.length===1){
   const row=rows[0]
   if(!validTask(row)||row.project_id!==input.projectId||row.status!=='ready'||row.version!==1)DENY()
   return toTask(row)
  }
  // Nothing inserted: this person already used this request id.
  const prior=await call('/rest/v1/friday_work_items?creator_principal=eq.'+encodeURIComponent(input.principalId)+
   '&request_id=eq.'+encodeURIComponent(input.requestId)+
   '&select='+encodeURIComponent([...TASK_FIELDS,'input_fingerprint'].join(','))+'&limit=1')
  if(prior.length!==1)DENY()
  const {input_fingerprint:fingerprint,...row}=prior[0]
  if(!validTask(row))DENY()
  if(fingerprint!==input.inputFingerprint||row.project_id!==input.projectId)CONFLICT()
  return toTask(row)
 }
 return Object.freeze({enabled:ready,create})
}
