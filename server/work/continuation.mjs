import {normalizeActor,safeWorkError} from './validation.mjs'
const forbidden=/(authorization\s*[:=]|bearer\s+[\w.-]{6,}|-----BEGIN|(?:api_key|secret|password|token)\s*=)/i
function sanitizeWork(work){
 if(!work||typeof work.id!=='string'||typeof work.projectId!=='string'||typeof work.objective!=='string'||
  !Array.isArray(work.acceptanceCriteria)||!Number.isSafeInteger(work.version))throw safeWorkError('storage-unavailable')
 return {id:work.id,projectId:work.projectId,objective:work.objective,
  acceptanceCriteria:work.acceptanceCriteria,status:work.status,version:work.version}
}
function handoffPacket(row){
 const source=row?.payload&&typeof row.payload==='object'?row.payload:row
 if(!source||forbidden.test(JSON.stringify(source)))return null
 return {summary:String(source.summary||'').slice(0,2000),
  ...(!source.recommendedNextCapability?{}:{recommendedNextCapability:String(source.recommendedNextCapability).slice(0,128)})}
}
export async function buildWorkContinuation({actor,workService,decisionService,memoryService,workItemId,scopes=[],maxChars=12000}={}){
 normalizeActor(actor)
 if(!Number.isInteger(maxChars)||maxChars<256||maxChars>64000)throw safeWorkError('invalid-input')
 const workItem=sanitizeWork(await workService.get({actor,workItemId}))
 const accepted=(await decisionService.listAccepted({actor,workItemId})).filter(x=>x.state==='accepted'&&!forbidden.test(JSON.stringify(x)))
  .map(d=>({id:d.id,summary:String(d.summary).slice(0,2000),provenance:String(d.provenance||'').slice(0,250)}))
 const latestHandoff=handoffPacket(await workService.getLatestHandoff({actor,workItemId}))
 const memories=await memoryService.search({actor,scopes,query:'',limit:20})
 const result={workItem,latestHandoff,acceptedDecisions:accepted,memory:[]}
 if(JSON.stringify({...result,memory:[]}).length>maxChars){
  // Never silently discard authoritative state to fit a budget.
  if(JSON.stringify({...result,latestHandoff:null,memory:[]}).length>maxChars)throw safeWorkError('invalid-input')
  result.latestHandoff=null
 }
 for(const m of memories){
  const row={id:m.id,scope:m.scope,ownerId:m.ownerId,excerpt:String(m.content||'').slice(0,1000),provenance:String(m.provenance||'').slice(0,250)}
  const probe={...result,memory:[...result.memory,row]}
  if(JSON.stringify(probe).length>maxChars)break
  result.memory.push(row)
 }
 return result
}