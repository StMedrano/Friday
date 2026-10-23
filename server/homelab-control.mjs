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
const confirmation=id=>`approve:${id}:${TARGET}:restart`

// Internal dependency-injection seam only. Not constructed by server/index.mjs,
// not an AI tool, and not an HTTP route. Never receives authority from model text.
export function createHomeLabControl({enabled=false,access,store,automationAllowed,
 diagnostics,config={},assistant=answerAssistant,fetchKeys,now=Date.now,diagnosticTimeoutMs=5000}={}) {
 const ready=enabled===true&&typeof store?.append==='function'&&typeof store?.read==='function'&&
  typeof automationAllowed==='function'&&Number.isInteger(diagnosticTimeoutMs)&&diagnosticTimeoutMs>=1&&diagnosticTimeoutMs<=5000
 const authorize=createAccessGate(access,fetchKeys?{fetchImpl:fetchKeys}:{})
 const active=()=>{if(!ready||automationAllowed()!==true)denied()}
 const record=(requestId,event,actor,at=now(),expiresAt=at)=>({requestId,event,actor,target:TARGET,at,expiresAt})
 async function actorFor(request) {
  active()
  const result=await authorize(request,true)
  if(result?.status!==200||!result.identity?.subject)denied()
  active()
  return createHash('sha256').update(result.identity.subject).digest('hex')
 }
 async function guarded(request,operation) {
  let actor='0'.repeat(64)
  try {actor=await actorFor(request);return await operation(actor)}
  catch {
   // Failure to durably record a denial still denies the operation. Never record
   // raw tokens, prompts, endpoints, provider exceptions or untrusted targets.
   if(ready)try {await store.append(record(randomUUID(),'denied',actor))}catch{}
   denied()
  }
 }
 return Object.freeze({
  enabled:ready,
  async inspect(request,input) {
   return guarded(request,async actor=>{
    if(!exact(input,['target','prompt'])||input.target!==TARGET||typeof diagnostics?.read!=='function')denied()
    const prompt=validateAssistantPrompt(input.prompt)
    if(!prompt.ok)denied()
    const requestId=randomUUID()
    await store.append(record(requestId,'diagnostic-started',actor))
    active()
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
    await store.append(record(requestId,'diagnostic-completed',actor))
    active()
    const overview={mode:'mock',services:[{id:TARGET,name:'Staging canary',
     category:'monitoring',host:'unbound',site:'staging',
     status:{healthy:'online',unhealthy:'offline',unknown:'unknown'}[status],
     detail:'Fixture diagnostics: '+status,updated:new Date(now()).toISOString()}]}
    const result=await assistant({config,prompt:prompt.prompt,overview})
    return {...result,requestId,evidenceMode:'fixture',execution:{...NO_EXECUTION}}
   })
  },
  async requestRestart(request,input) {
   return guarded(request,async actor=>{
    if(!exact(input,['target'])||input.target!==TARGET)denied()
    const requestId=randomUUID(),at=now()
    await store.append(record(requestId,'restart-requested',actor,at,at+300000))
    return {requestId,target:TARGET,state:'pending-approval',confirmation:confirmation(requestId),execution:{...NO_EXECUTION}}
   })
  },
  async approveRestart(request,input) {
   return guarded(request,async actor=>{
    if(!exact(input,['requestId','confirmation'])||!validRequestId(input.requestId)||input.confirmation!==confirmation(input.requestId))denied()
    const requested=await store.read(input.requestId,'restart-requested')
    const at=now()
    if(!requested||requested.target!==TARGET||requested.at>at||requested.expiresAt<=at)denied()
    active()
    // Exclusive create in the durable store makes approval single-use across
    // service instances. Approval is a record, never execution authority.
    await store.append(record(input.requestId,'restart-approved',actor,at,requested.expiresAt))
    return {requestId:input.requestId,target:TARGET,state:'approved-execution-unavailable',execution:{...NO_EXECUTION}}
   })
  },
 })
}
