import {normalizeActor} from '../work/validation.mjs'
import {FabricPolicyError} from './manifest-validation.mjs'
import {resolveEffectivePolicy} from './policy-resolver.mjs'
import {serializeSafeContext} from './safe-context.mjs'

const fail=(kind='not-authorized')=>{throw new FabricPolicyError(kind)}
const same=(x,y)=>x===y&&typeof x==='string'&&x.length>0
const has=xs=>Array.isArray(xs)?xs:[]
function sanitizeWork(work,id,actor){
 if(!work||!same(work.id,id)||!actor.allowedProjectIds.includes(work.projectId)||
    typeof work.objective!=='string'||!Array.isArray(work.acceptanceCriteria)||
    !Number.isSafeInteger(work.version)||work.version<1)fail('not-authorized')
 return {id:work.id,projectId:work.projectId,status:work.status,version:work.version,objective:work.objective,acceptanceCriteria:work.acceptanceCriteria}
}
function acceptedDecisions(rows,workItemId){
 if(!Array.isArray(rows))fail('storage-unavailable')
 const decisions=[]
 for(const d of rows){
  if(!d||!same(d.workItemId,workItemId))fail('storage-unavailable')
  if(d.state!=='accepted')continue
  if(typeof d.id!=='string'||typeof d.summary!=='string')fail('storage-unavailable')
  decisions.push({id:d.id,summary:d.summary,provenance:typeof d.provenance==='string'?d.provenance:'',trust:'authoritative'})
 }
 return decisions.sort((a,b)=>a.id.localeCompare(b.id))
}
function advisoryHandoff(row,workItemId){
 if(row===null||row===undefined)return null
 if(!same(row.workItemId,workItemId))fail('storage-unavailable')
 const value=row.payloadJson||row.payload||row
 if(!value||typeof value.summary!=='string')fail('storage-unavailable')
 return {summary:value.summary,recommendedNextCapability:typeof value.recommendedNextCapability==='string'?value.recommendedNextCapability:null,trust:'advisory'}
}
function advisoryMemories(rows,scopes,projectId){
 if(!Array.isArray(rows))fail('storage-unavailable')
 const allowed=new Set(scopes.map(s=>JSON.stringify([s.scope,s.ownerId])))
 const out=[]
 for(const row of rows){
  if(!row||!allowed.has(JSON.stringify([row.scope,row.ownerId]))||
     (row.projectId!==null&&row.projectId!==undefined&&row.projectId!==projectId))continue
  if(typeof row.content!=='string'||typeof row.id!=='string')continue
  out.push({id:row.id,scope:row.scope,ownerId:row.ownerId,excerpt:row.content,provenance:typeof row.provenance==='string'?row.provenance:'',trust:'advisory'})
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id))
}
export async function buildAgentContext({actor,agentId,workItemId,taskPolicy,catalog,registryService,workService,decisionService,memoryService,sessionContext,serverCeilings,maxChars=12000}={}){
 let a
 try{a=normalizeActor(actor)}catch{fail()}
 if(typeof agentId!=='string'||!a.allowedAgentIds.includes(agentId)||
    typeof workItemId!=='string'||!workItemId||!registryService?.get||!workService?.get||
    !workService?.getLatestHandoff||!decisionService?.listAccepted||!memoryService?.search)fail()
 const agent=await registryService.get(agentId)
 if(!agent||agent.id!==agentId||agent.enabled!==true)fail()
 const work=sanitizeWork(await workService.get({actor:a,workItemId}),workItemId,a)
 const policy=resolveEffectivePolicy({catalog,agent,actor:a,projectId:work.projectId,workItem:work,taskPolicy,serverCeilings})
 const decisionRows=await decisionService.listAccepted({actor:a,workItemId})
 const accepted=acceptedDecisions(decisionRows,workItemId)
 const handoff=advisoryHandoff(await workService.getLatestHandoff({actor:a,workItemId}),workItemId)
 const rows=await memoryService.search({actor:a,scopes:policy.memoryScopeRequests,query:'',limit:20})
 const memory=advisoryMemories(rows,policy.memoryScopeRequests,work.projectId)
 const mandatory={
  schemaVersion:'1',source:{gitCommit:catalog.sourceCommit||'',policyHash:catalog.policyHash||'',agentChecksum:agent.source?.checksum||''},
  agent:{id:agent.id,name:agent.name||'',modelProfile:agent.model?.profile||null,groupId:policy.groupId},
  policy,workItem:work,acceptedDecisions:accepted,
  execution:{performed:false},
 }
 const optional=[...(handoff?[{field:'latestHandoff',value:handoff}]:[]),...memory.map(value=>({field:'memory',value}))]
 return serializeSafeContext({mandatory,optional,maxChars})
}
