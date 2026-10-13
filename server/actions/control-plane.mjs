import { randomUUID } from 'node:crypto'

// Internal, opt-in action lifecycle only. No HTTP routes, Docker socket,
// SSH, shell, Proxmox writes, or model-driven executor are provided.
const TYPES=new Set(['service.restart'])
const TARGET=/^(?:vm100|vm102):[a-z0-9][a-z0-9._-]{1,63}$/
const rejected=(reason)=>{throw new Error(reason)}
const verified=(actor,role)=>
 actor?.verified===true &&
 ['operator','administrator'].includes(actor.role) &&
 (role!=='administrator'||actor.role==='administrator') &&
 typeof actor.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actor.email)
const safeRequest=(r)=>({requestId:r.requestId,actionId:r.actionId,target:r.target,status:r.status})

export function createActionController({
 journal,executor,allowlist=[],executionEnabled=false,killSwitch=true,idFactory=randomUUID,
}={}){
 if(typeof journal?.append!=='function')rejected('durable-audit-required')
 if(typeof executor?.dispatch!=='function')rejected('scoped-executor-required')
 const allowed=new Set()
 for(const x of allowlist){
  if(!TYPES.has(x?.actionId)||!TARGET.test(x?.target||''))rejected('invalid-allowlist')
  allowed.add(x.actionId+'|'+x.target)
 }
 const state=new Map()
 const save=async(event,record,actor)=>{
  const audit={event,requestId:record.requestId,actionId:record.actionId,target:record.target,actor:actor.email}
  try{await journal.append(audit)}catch{rejected('audit-write-failed')}
 }
 return Object.freeze({
  async request({actor,actionId,target}={}){
   if(!verified(actor))rejected('verified-operator-required')
   if(!TYPES.has(actionId)||!TARGET.test(target||'')||!allowed.has(actionId+'|'+target))
    rejected('action-not-allowlisted')
   const r={requestId:idFactory(),actionId,target,status:'pending',requester:actor.email.toLowerCase()}
   if(typeof r.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(r.requestId)||state.has(r.requestId))rejected('invalid-request-id')
   await save('requested',r,actor)
   state.set(r.requestId,r)
   return safeRequest(r)
  },
  async approve({actor,requestId}={}){
   if(!verified(actor,'administrator'))rejected('verified-administrator-required')
   const r=state.get(requestId)
   if(!r||r.status!=='pending')rejected('request-not-pending')
   if(actor.email.toLowerCase()===r.requester)rejected('self-approval-denied')
   await save('approved',r,actor)
   r.status='approved'
   return safeRequest(r)
  },
  async execute({actor,requestId}={}){
   if(!verified(actor,'administrator'))rejected('verified-administrator-required')
   if(executionEnabled!==true)rejected('execution-disabled')
   if(killSwitch!==false)rejected('kill-switch-engaged')
   const r=state.get(requestId)
   if(!r||r.status!=='approved')rejected('request-not-approved')
   if(!allowed.has(r.actionId+'|'+r.target))rejected('action-not-allowlisted')
   // Update state before awaiting I/O to block concurrent duplicate execution.
   r.status='audit-pending'
   try{await save('execution-started',r,actor)}
   catch{r.status='blocked';rejected('audit-write-failed')}
   r.status='executing'
   let succeeded=false
   try{
    await executor.dispatch(Object.freeze({actionId:r.actionId,target:r.target,requestId:r.requestId}))
    succeeded=true
   }catch{}
   r.status=succeeded?'succeeded':'failed'
   try{await save('execution-'+r.status,r,actor)}
   catch{r.status='unknown';rejected('audit-write-failed-after-execution')}
   return safeRequest(r)
  },
 })
}
