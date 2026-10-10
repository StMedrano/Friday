import {createHash} from 'node:crypto'
import {
 normalizeActor,safeWorkError,validateWorkCreate,validateClaim,
 validateCheckpoint,validateHandoff
} from './validation.mjs'
const has=(xs,v)=>xs.includes(v)
function workId(v) {
 if(typeof v!=='string'||!v.trim()||v.length>128)throw safeWorkError('invalid-input')
 return v.trim()
}
function fingerprint(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function checkedVersion(v) {
 if(!Number.isSafeInteger(v)||v<1)throw safeWorkError('invalid-input')
 return v
}
function checkProject(actor,item) {
 if(!item||!has(actor.allowedProjectIds,item.projectId))throw safeWorkError('not-found')
 return item
}
function ensureResult(result){
 if(!result||typeof result!=='object')throw safeWorkError('storage-unavailable')
 if(result.error)throw safeWorkError(result.error)
 return result
}
export function createWorkService({repository,agentAuthorizer=()=>false}={}){
 if(!repository)throw safeWorkError('storage-unavailable')
 const authorize=actor=>normalizeActor(actor)
 const load=async(actor,id)=>checkProject(actor,await repository.get(workId(id)))
 async function currentClaim(actor,claimId,runId){
  const c=await repository.getClaim(workId(claimId))
  if(!c)throw safeWorkError('not-found')
  await load(actor,c.workItemId)
  if(c.principalId!==actor.principalId||c.runId!==runId||!has(actor.allowedAgentIds,c.agentId))throw safeWorkError('not-authorized')
  return c
 }
 return Object.freeze({
  async create({actor,projectId,title,objective,acceptanceCriteria,requestId}={}){
   const a=authorize(actor)
   const input=validateWorkCreate({projectId,title,objective,acceptanceCriteria,requestId})
   if(!has(a.allowedProjectIds,input.projectId))throw safeWorkError('not-authorized')
   return repository.create({...input,principalId:a.principalId,inputFingerprint:fingerprint(input)})
  },
  async get({actor,workItemId}={}){return load(authorize(actor),workItemId)},
  async list({actor,projectId,limit=20}={}){
   const a=authorize(actor)
   if(!has(a.allowedProjectIds,workId(projectId)))throw safeWorkError('not-authorized')
   if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw safeWorkError('invalid-input')
   return repository.list({projectId,limit})
  },
  async claim({actor,workItemId,agentId,runId,expectedVersion,leaseSeconds,requestId}={}){
   const a=authorize(actor)
   await load(a,workItemId)
   if(!has(a.allowedAgentIds,agentId)||!await agentAuthorizer(a,agentId))throw safeWorkError('not-authorized')
   const c=validateClaim({agentId,runId,expectedVersion,leaseSeconds,requestId})
   return ensureResult(await repository.claim({workId:workItemId,...c,principalId:a.principalId}))
  },
  async renew({actor,claimId,runId,expectedVersion,leaseSeconds}={}){
   const a=authorize(actor); await currentClaim(a,claimId,runId)
   validateClaim({agentId:'existing',runId,expectedVersion,leaseSeconds})
   return ensureResult(await repository.renew({claimId,runId,expectedVersion,leaseSeconds}))
  },
  async checkpoint({actor,claimId,runId,expectedVersion,packet,requestId}={}){
   const a=authorize(actor); await currentClaim(a,claimId,runId)
   checkedVersion(expectedVersion)
   if(typeof requestId!=='string'||!requestId.trim())throw safeWorkError('invalid-input')
   return ensureResult(await repository.checkpoint({claimId,runId,expectedVersion,requestId,packet:validateCheckpoint(packet)}))
  },
  async handoff({actor,claimId,runId,expectedVersion,packet,requestId}={}){
   const a=authorize(actor); await currentClaim(a,claimId,runId)
   checkedVersion(expectedVersion)
   if(typeof requestId!=='string'||!requestId.trim())throw safeWorkError('invalid-input')
   return ensureResult(await repository.handoff({claimId,runId,expectedVersion,requestId,packet:validateHandoff(packet)}))
  },
  async release({actor,claimId,runId,expectedVersion,nextStatus}={}){
   const a=authorize(actor);await currentClaim(a,claimId,runId)
   checkedVersion(expectedVersion)
   if(!['ready','blocked','review','completed','cancelled'].includes(nextStatus))throw safeWorkError('invalid-input')
   return ensureResult(await repository.release({claimId,runId,expectedVersion,nextStatus}))
  },
  async getLatestHandoff({actor,workItemId}={}){
   const a=authorize(actor);await load(a,workItemId)
   return repository.getLatestHandoff({workItemId})
  },
 })
}