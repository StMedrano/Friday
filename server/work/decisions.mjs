import {createHash} from 'node:crypto'
import {normalizeActor,safeWorkError} from './validation.mjs'
const prohibited=/(authorization\s*[:=]|bearer\s+[\w.-]{6,}|-----BEGIN|(?:api_key|secret|password|token)\s*=)/i
function inputString(x,max){if(typeof x!=='string'||!x.trim()||x.length>max||prohibited.test(x))throw safeWorkError('invalid-input');return x.trim()}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex')}
function ref(value,max){
 const v=inputString(value,max)
 if(v.includes('..')||v.startsWith('/')||/[?#\\\s]/.test(v)||! /^[a-z0-9][a-z0-9._:/@-]*$/i.test(v))throw safeWorkError('invalid-input')
 return v
}
function requireWork(actor,work){
 if(!work||!actor.allowedProjectIds.includes(work.projectId))throw safeWorkError('not-found')
 return work
}
export function createDecisionService({repository,reviewAuthorizer=()=>false}={}){
 if(!repository)throw safeWorkError('storage-unavailable')
 const allowed=async(actor,workId)=>requireWork(actor,await repository.get(workId))
 return Object.freeze({
  async propose({actor,workItemId,summary,provenance,requestId}={}){
   const a=normalizeActor(actor);await allowed(a,workItemId)
   const data={workItemId,summary:inputString(summary,2000),provenance:inputString(provenance,500),
    requestId:inputString(requestId,128),principalId:a.principalId}
   return repository.decisionInsert({...data,inputFingerprint:digest(data)})
  },
  async review({actor,decisionId,verdict,expectedVersion}={}){
   const a=normalizeActor(actor)
   if(!['accepted','rejected'].includes(verdict)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw safeWorkError('invalid-input')
   const decision=await repository.getDecision(inputString(decisionId,128))
   if(!decision)throw safeWorkError('not-found')
   await allowed(a,decision.workItemId)
   if(!await reviewAuthorizer(a,decision))throw safeWorkError('not-authorized')
   const result=await repository.reviewDecision({decisionId,expectedVersion,reviewerId:a.principalId,verdict})
   if(result?.error)throw safeWorkError(result.error)
   return result
  },
  async listAccepted({actor,workItemId}={}){
   const a=normalizeActor(actor);await allowed(a,workItemId)
   const list=await repository.listAcceptedDecisions(workItemId)
   return (list||[]).filter(d=>d.state==='accepted')
  },
  async attachArtifactMetadata({actor,workItemId,gitRef,artifactRef,requestId}={}){
   const a=normalizeActor(actor);await allowed(a,workItemId)
   const data={workItemId,gitRef:ref(gitRef,500),artifactRef:ref(artifactRef,500),
    requestId:inputString(requestId,128),principalId:a.principalId}
   return repository.artifactInsert({...data,inputFingerprint:digest(data)})
  },
 })
}