import {createHash} from 'node:crypto'
import {safeWorkError} from './validation.mjs'

function encode(value){return encodeURIComponent(String(value))}
function normalized(row) {
 if(!row||typeof row!=='object')return null
 const result={}
 for(const [name,value] of Object.entries(row)){
   const key=name.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())
   result[key]=value
 }
 return result
}
export function createSupabaseWorkRepository({baseUrl,serviceKey,fetchImpl=globalThis.fetch,timeoutMs=10000}={}){
 const key=String(serviceKey||'')
 let root=''
 try {
  const u=new URL(baseUrl)
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error()
  root=u.toString().replace(/\/+$/,'')
 }catch{}
 async function request(path,{method='GET',body,prefer}={}){
  if(!root||!key||typeof fetchImpl!=='function')throw safeWorkError('storage-unavailable')
  let response
  try{
   response=await fetchImpl(root+path,{method,headers:{
    apikey:key,authorization:'Bearer '+key,'content-type':'application/json',
    accept:'application/json',...(prefer?{prefer}:{})
   },signal:AbortSignal.timeout(timeoutMs),...(body===undefined?{}:{body:JSON.stringify(body)})})
  }catch{throw safeWorkError('storage-unavailable')}
  if(!response?.ok){
   if(response?.status===409)throw safeWorkError('version-conflict')
   if(response?.status===404)throw safeWorkError('not-found')
   throw safeWorkError('storage-unavailable')
  }
  try{return await response.json()}catch{throw safeWorkError('storage-unavailable')}
 }
 const rpc=(name,body)=>request('/rest/v1/rpc/'+name,{method:'POST',body})
 const first=async(path)=>{const rows=await request(path);return Array.isArray(rows)?normalized(rows[0]):null}
 async function insertOnce(table,principalColumn,body){
  const rows=await request('/rest/v1/'+table+'?on_conflict='+principalColumn+',request_id',{
   method:'POST',body,prefer:'resolution=ignore-duplicates,return=representation'
  })
  if(Array.isArray(rows)&&rows.length)return normalized(rows[0])
  const prior=await first('/rest/v1/'+table+'?'+principalColumn+'=eq.'+encode(body[principalColumn])+
    '&request_id=eq.'+encode(body.request_id)+'&select=*')
  if(prior&&prior.inputFingerprint===body.input_fingerprint)return prior
  throw safeWorkError('idempotency-conflict')
 }
 return Object.freeze({
  get:(id)=>first('/rest/v1/friday_work_items?id=eq.'+encode(id)+'&select=*'),
  list:async({projectId,limit=20})=>{
   const rows=await request('/rest/v1/friday_work_items?project_id=eq.'+encode(projectId)+'&select=*&order=created_at.desc&limit='+Math.min(50,limit))
   return Array.isArray(rows)?rows.map(normalized):[]
  },
  getClaim:(id)=>first('/rest/v1/friday_work_claims?id=eq.'+encode(id)+'&select=*'),
  create:(row)=>insertOnce('friday_work_items','creator_principal',{
   project_id:row.projectId,title:row.title,objective:row.objective,
   acceptance_criteria:row.acceptanceCriteria,creator_principal:row.principalId,
   request_id:row.requestId,input_fingerprint:row.inputFingerprint
  }),
  claim:({workId,expectedVersion,principalId,agentId,runId,leaseSeconds,requestId})=>rpc('friday_claim_work',{
   work_id:workId,expected_version:expectedVersion,principal_id:principalId,
   agent_id:agentId,run_id:runId,lease_seconds:leaseSeconds,request_id:requestId
  }),
  renew:({claimId,runId,expectedVersion,leaseSeconds})=>rpc('friday_renew_claim',{
   claim_id:claimId,run_id:runId,expected_version:expectedVersion,lease_seconds:leaseSeconds
  }),
  checkpoint:({claimId,runId,expectedVersion,requestId,packet})=>rpc('friday_append_checkpoint',{
   claim_id:claimId,run_id:runId,expected_version:expectedVersion,request_id:requestId,payload_json:packet
  }),
  handoff:({claimId,runId,expectedVersion,requestId,packet})=>rpc('friday_append_handoff',{
   claim_id:claimId,run_id:runId,expected_version:expectedVersion,request_id:requestId,payload_json:packet
  }),
  release:({claimId,runId,expectedVersion,nextStatus})=>rpc('friday_release_claim',{
   claim_id:claimId,run_id:runId,expected_version:expectedVersion,next_status:nextStatus
  }),
  getLatestHandoff:async({workItemId})=>first('/rest/v1/friday_handoffs?work_item_id=eq.'+encode(workItemId)+'&select=*&order=work_version.desc,id.desc&limit=1'),
  memoryPut:(row)=>insertOnce('friday_memories','principal_id',{
   scope:row.scope,owner_id:row.ownerId,content:row.content,provenance:row.provenance,
   project_id:row.projectId,principal_id:row.principalId,request_id:row.requestId,
   input_fingerprint:createHash('sha256').update(JSON.stringify({
     scope:row.scope,ownerId:row.ownerId,content:row.content,provenance:row.provenance
   })).digest('hex')
  }),
  memoryGet:(id)=>first('/rest/v1/friday_memories?id=eq.'+encode(id)+'&select=*'),
  async memorySearch({scope,ownerId,projectId,limit=100}){
   const path='/rest/v1/friday_memories?scope=eq.'+encode(scope)+'&owner_id=eq.'+encode(ownerId)+
    (projectId?'&project_id=eq.'+encode(projectId):'')+'&select=*&order=created_at.desc&limit='+Math.min(100,limit)
   const rows=await request(path)
   return Array.isArray(rows)?rows.map(normalized):[]
  },
  decisionInsert:(row)=>insertOnce('friday_decisions','principal_id',{
   work_item_id:row.workItemId,summary:row.summary,provenance:row.provenance,
   principal_id:row.principalId,request_id:row.requestId,input_fingerprint:row.inputFingerprint
  }),
  getDecision:(id)=>first('/rest/v1/friday_decisions?id=eq.'+encode(id)+'&select=*'),
  reviewDecision:({decisionId,expectedVersion,reviewerId,verdict})=>rpc('friday_review_decision',{
   decision_id:decisionId,expected_version:expectedVersion,reviewer_id:reviewerId,verdict
  }),
  async listAcceptedDecisions(workItemId){
   const rows=await request('/rest/v1/friday_decisions?work_item_id=eq.'+encode(workItemId)+
    '&state=eq.accepted&select=*&order=created_at.asc,id.asc')
   return Array.isArray(rows)?rows.map(normalized):[]
  },
  artifactInsert:(row)=>insertOnce('friday_artifacts','principal_id',{
   work_item_id:row.workItemId,ref_kind:'git',reference:row.gitRef,artifact_ref:row.artifactRef,
   principal_id:row.principalId,request_id:row.requestId,input_fingerprint:row.inputFingerprint
  }),
  async workProjectId(workItemId){
   const item=await first('/rest/v1/friday_work_items?id=eq.'+encode(workItemId)+'&select=project_id')
   return item?.projectId||null
  },

 })
}