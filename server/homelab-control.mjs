import {createHash, randomUUID} from 'node:crypto'
import {createAccessGate} from './security/access.mjs'
import {validateAssistantPrompt} from './assistant-input.mjs'
import {answerAssistant} from './assistant.mjs'
import {validRequestId} from './homelab-audit.mjs'

const TARGET='staging-canary' // Symbolic reserved target; no host/container binding.
const NO_EXECUTION=Object.freeze({performed:false,reason:'Safety foundation only; restart execution is unavailable.'})
const denied=()=>{throw Error('homelab-denied')}
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const confirmation=(id,outcome='approved')=>
 `${{approved:'approve',rejected:'reject',withdrawn:'withdraw'}[outcome]}:${id}:${TARGET}:restart`

// Internal dependency-injection seam only. Not constructed by server/index.mjs,
// not an AI tool, and not an HTTP route. Never receives authority from model text.
export function createHomeLabControl({enabled=false,access,identityGate,store,automationAllowed,rolePolicy,
 diagnostics,config={},assistant=answerAssistant,fetchKeys,now=Date.now,diagnosticTimeoutMs=5000}={}) {
 const ready=enabled===true&&typeof store?.append==='function'&&typeof store?.read==='function'&&
  typeof automationAllowed==='function'&&typeof rolePolicy?.permits==='function'&&Number.isInteger(diagnosticTimeoutMs)&&diagnosticTimeoutMs>=1&&diagnosticTimeoutMs<=5000
 // A non-default gate is injected ONLY by the dormant Authentik factory.
 // No header-based autodetection, no Cloudflare fallback when it is selected.
 const authorize=identityGate===undefined?
  createAccessGate(access,fetchKeys?{fetchImpl:fetchKeys}:{}):
  typeof identityGate==='function'?identityGate:
   async()=>({status:503,error:'identity-gate-invalid'})
 const active=()=>{if(!ready||automationAllowed()!==true)denied()}
 const liveIdentity=identity=>{
  // Authentik's verified token expiration is an upper bound on the identity
  // for *the entire async operation*, not merely its entry point. Do not
  // trust expiry fields supplied by browser/LLM; only gate-issued identity.
  if(identity?.expiresAtMs===undefined)return
  const at=now()
  if(!Number.isSafeInteger(at)||!Number.isSafeInteger(identity.expiresAtMs)||
     identity.expiresAtMs<=at)denied()
 }
 const record=(requestId,event,actor,at=now(),expiresAt=at)=>({requestId,event,actor,target:TARGET,at,expiresAt})
 async function actorFor(request,capability) {
  active()
  // A verified Access JWT supplies identity; never trust role/target headers or model text.
  // The server-owned role snapshot provides an independent exact capability grant.
  const result=await authorize(request,false)
  if(result?.status!==200||!result.identity?.subject||
    !rolePolicy.permits(result.identity,capability,TARGET))denied()
  liveIdentity(result.identity)
  active()
  return {actor:createHash('sha256').update(result.identity.subject).digest('hex'),identity:result.identity}
 }
 async function guarded(request,capability,operation) {
  let actor='0'.repeat(64)
  try {
   const verified=await actorFor(request,capability)
   actor=verified.actor
   const reauthorize=()=>{
    active()
    // Re-evaluate revocable server-owned policy after every asynchronous
    // trust boundary. The JWT identity was verified by actorFor, not a header.
    if(rolePolicy.permits(verified.identity,capability,TARGET)!==true)denied()
    liveIdentity(verified.identity)
    active()
   }
   return await operation(actor,reauthorize,verified.identity)
  }
  catch {
   // Failure to durably record a denial still denies the operation. Never record
   // raw tokens, prompts, endpoints, provider exceptions or untrusted targets.
   if(ready)try {await store.append(record(randomUUID(),'denied',actor))}catch{}
   denied()
  }
 }
 async function decideRestart(request,input,outcome,capability) {
  return guarded(request,capability,async (actor,reauthorize)=>{
   if(!exact(input,['requestId','confirmation'])||!validRequestId(input.requestId)||
      input.confirmation!==confirmation(input.requestId,outcome))denied()
   const proposal=await store.read(input.requestId,'restart-requested')
   reauthorize()
   const at=now()
   if(!proposal||proposal.target!==TARGET||proposal.at>at||proposal.expiresAt<=at||
      (outcome==='withdrawn'?proposal.actor!==actor:proposal.actor===actor))denied()
   reauthorize()
   // All three outcomes race on one O_EXCL create-only pathname. There is
   // no separate approve/reject/withdraw marker that could conflict.
   await store.append({...record(input.requestId,'restart-decided',actor,at,proposal.expiresAt),outcome})
   reauthorize()
   const state={approved:'approved-execution-unavailable',
    rejected:'rejected',withdrawn:'withdrawn'}[outcome]
   return {requestId:input.requestId,target:TARGET,state,execution:{...NO_EXECUTION}}
  })
 }
 return Object.freeze({
  enabled:ready,
  async inspect(request,input) {
   return guarded(request,'diagnostics.read',async (actor,reauthorize)=>{
    if(!exact(input,['target','prompt'])||input.target!==TARGET||typeof diagnostics?.read!=='function')denied()
    const prompt=validateAssistantPrompt(input.prompt)
    if(!prompt.ok)denied()
    const requestId=randomUUID()
    await store.append(record(requestId,'diagnostic-started',actor))
    reauthorize()
    let status
    const controller=new AbortController()
    let timer
    try {
     // The adapter is server-provisioned, read-only, with no URL/command input.
     // No adapter or provider credential is loaded by this module.
     const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(Error('homelab-denied'))},diagnosticTimeoutMs)
     })
     const evidence=await Promise.race([diagnostics.read(TARGET,{signal:controller.signal}),timeout])
     if(!['healthy','unhealthy','unknown'].includes(evidence?.status))denied()
     status=evidence.status
    } catch {
     await store.append(record(requestId,'diagnostic-failed',actor))
     denied()
    } finally {clearTimeout(timer);controller.abort()}
    reauthorize()
    await store.append(record(requestId,'diagnostic-completed',actor))
    reauthorize()
    const overview={mode:'mock',services:[{id:TARGET,name:'Staging canary',
     category:'monitoring',host:'unbound',site:'staging',
     status:{healthy:'online',unhealthy:'offline',unknown:'unknown'}[status],
     detail:'Fixture diagnostics: '+status,updated:new Date(now()).toISOString()}]}
    const result=await assistant({config,prompt:prompt.prompt,overview})
    reauthorize()
    return {...result,requestId,evidenceMode:'fixture',execution:{...NO_EXECUTION}}
   })
  },
  async getRequestStatus(request,input) {
   return guarded(request,'diagnostics.read',async (actor,reauthorize,identity)=>{
    if(!exact(input,['requestId'])||!validRequestId(input.requestId)||
       typeof store.readLifecycle!=='function')denied()
    const scope=()=>{
     reauthorize()
     const administrator=rolePolicy.permits(identity,'action.approve',TARGET)===true
     const proposer=rolePolicy.permits(identity,'action.propose',TARGET)===true
     if(!administrator&&!proposer)denied()
     reauthorize()
     return {administrator,proposer}
    }
    // Deny Viewer/Agent before reading private audit metadata.
    scope()
    const row=await store.readLifecycle({requestId:input.requestId,at:now()})
    const rights=scope()
    const terminal=['approved-execution-unavailable','rejected','withdrawn'].includes(row?.state)
    const current=now()
    if(row?.requestId!==input.requestId||row.target!==TARGET||
       !/^[a-f0-9]{64}$/.test(row.actor)||!Number.isSafeInteger(row.at)||
       !Number.isSafeInteger(row.expiresAt)||row.expiresAt<=row.at||
       row.expiresAt-row.at>300000||!Number.isSafeInteger(current)||row.at>current||
       !['pending-approval','expired','approved-execution-unavailable','rejected','withdrawn'].includes(row.state)||
       (row.state==='pending-approval'&&row.expiresAt<=current)||
       (row.state==='expired'&&row.expiresAt>current)||
       (terminal?(!Number.isSafeInteger(row.decidedAt)||row.decidedAt<row.at||
         row.decidedAt>row.expiresAt||!/^[a-f0-9]{64}$/.test(row.decidedBy)||
         (row.state==='withdrawn'?row.decidedBy!==row.actor:
           row.decidedBy===row.actor)):
         row.decidedAt!==null||row.decidedBy!==null)||
       (!rights.administrator&&(!rights.proposer||row.actor!==actor)))denied()
    // Never return actor hashes, raw durable records, JWT metadata or
    // confirmation strings. Historical approval is NOT authority to execute.
    reauthorize()
    return {requestId:row.requestId,target:TARGET,state:row.state,
      requestedAt:row.at,expiresAt:row.expiresAt,
      decidedAt:row.decidedAt,execution:{...NO_EXECUTION}}
   })
  },
  async listPendingApprovals(request,input) {
   return guarded(request,'action.approve',async (actor,reauthorize)=>{
    if(!exact(input,['limit'])||!Number.isSafeInteger(input.limit)||
      input.limit<1||input.limit>50||typeof store.listPending!=='function')denied()
    const pending=await store.listPending({at:now(),limit:input.limit})
    reauthorize()
    if(!Array.isArray(pending)||pending.length>input.limit)denied()
    // Storage metadata is never returned raw. No actor hash or token in the
    // administrative projection, and the approver cannot approve self-proposals.
    const items=pending.map(item=>{
     if(!validRequestId(item?.requestId)||item.target!==TARGET||
      !/^[a-f0-9]{64}$/.test(item.actor)||!Number.isSafeInteger(item.at)||
      !Number.isSafeInteger(item.expiresAt)||item.expiresAt<=item.at)denied()
     return {requestId:item.requestId,target:TARGET,state:'pending-approval',
       requestedAt:item.at,expiresAt:item.expiresAt,canApprove:item.actor!==actor}
    })
    reauthorize()
    return {items,execution:{...NO_EXECUTION}}
   })
  },
  async requestRestart(request,input) {
   return guarded(request,'action.propose',async (actor,reauthorize)=>{
    if(!exact(input,['target'])||input.target!==TARGET)denied()
    const requestId=randomUUID(),at=now()
    reauthorize()
    await store.append(record(requestId,'restart-requested',actor,at,at+300000))
    reauthorize()
    return {requestId,target:TARGET,state:'pending-approval',
     confirmation:confirmation(requestId),withdrawalConfirmation:confirmation(requestId,'withdrawn'),
     execution:{...NO_EXECUTION}}
   })
  },
  async approveRestart(request,input) {
   return decideRestart(request,input,'approved','action.approve')
  },
  async rejectRestart(request,input) {
   return decideRestart(request,input,'rejected','action.approve')
  },
  async withdrawRestart(request,input) {
   return decideRestart(request,input,'withdrawn','action.propose')
  },
 })
}
