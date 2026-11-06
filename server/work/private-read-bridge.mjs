import {createHash} from 'node:crypto'
import {createAccessGate} from '../security/access.mjs'
import {normalizeActor} from './validation.mjs'

const TASK_STATUSES=new Set(['ready','in_progress','blocked','review','completed','cancelled'])
const MEMORY_SCOPES=new Set(['global','organization','project','group','agent','task'])
const forbidden=/(-----BEGIN [\w ]*PRIVATE KEY-----|authorization\s*[:=]|bearer\s+[\w.-]{6,}|[\w]*(?:api_key|secret|password|token)[\w]*\s*=|sk-[\w-]{8,})/i
const deny=()=>{throw Error('work-read-denied')}
const exact=(obj,allowed,required=allowed)=>
 obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(obj,k))
const id=s=>typeof s==='string'&&s.trim()===s&&s.length>=1&&s.length<=128&&
 !forbidden.test(s)&&!s.includes('\0')
const cleanString=(s,max)=>typeof s==='string'&&s.trim()!==''&&s.length<=max&&
 !forbidden.test(s)
const int=(v,max)=>Number.isSafeInteger(v)&&v>=1&&v<=max
const unused=Object.freeze({enabled:false,canCreateTasks:false,
 listTasks:async()=>deny(),getTask:async()=>deny(),searchMemory:async()=>deny(),
 createTask:async()=>deny()})
const writeError=code=>{const e=Error('work-write-'+code);e.code=code;return e}
const TITLE_MAX=160,OBJECTIVE_MAX=4000

const safeTask=(row,allowedProjects,expectedProject)=>{
 if(!row||typeof row!=='object'||!id(row.id)||!id(row.projectId)||
    !allowedProjects.includes(row.projectId)||
    (expectedProject&&row.projectId!==expectedProject)||
    !cleanString(row.title,160)||!TASK_STATUSES.has(row.status)||
    !Number.isSafeInteger(row.version)||row.version<1)deny()
 return {id:row.id,projectId:row.projectId,title:row.title,
  status:row.status,version:row.version}
}
const safeMemory=(row,allowedProjects,requested,query)=>{
 if(!row||typeof row!=='object'||!id(row.id)||!id(row.ownerId)||
    !MEMORY_SCOPES.has(row.scope)||!requested.has(row.scope+':'+row.ownerId)||
    !cleanString(row.content,4000)||!cleanString(row.provenance,500)||
    !row.content.toLowerCase().includes(query.toLowerCase())||
    (row.projectId!=null&&(!id(row.projectId)||!allowedProjects.includes(row.projectId)))||
    (row.scope==='project'&&row.projectId!==row.ownerId))deny()
 return {id:row.id,scope:row.scope,ownerId:row.ownerId,
  projectId:row.projectId??null,content:row.content,provenance:row.provenance}
}
const checkedScopes=(scopes,actor)=>{
 if(!Array.isArray(scopes)||scopes.length>10)deny()
 const allowed=new Set(actor.allowedMemoryScopes.map(x=>x.scope+':'+x.ownerId))
 const seen=new Set()
 for(const scope of scopes){
  if(!exact(scope,['scope','ownerId'])||!MEMORY_SCOPES.has(scope.scope)||
    !id(scope.ownerId))deny()
  const key=scope.scope+':'+scope.ownerId
  if(!allowed.has(key)||seen.has(key))deny()
  if(scope.scope==='project'&&!actor.allowedProjectIds.includes(scope.ownerId))deny()
  seen.add(key)
 }
 return seen
}

/**
 * Source-only, default-disabled Phase 2B read bridge.
 *
 * The signed human Cloudflare Access subject determines identity; ONLY a
 * server-owned provisioner may return project/scope grants. Neither prompts,
 * client headers, nor caller-requested actor/roles can create permissions.
 * Returns bounded, redacted task/memory projections. No HTTP routes, Supabase
 * connection or account provisioning. Its only write is createTask, present
 * only when an insert-only taskWriter is injected (see task-insert-repository).
 */
export function createPrivateWorkReadBridge({
 enabled=false,access,workService,memoryService,grantsForSubject,fetchKeys,taskWriter=null,
}={}){
 if(enabled!==true||access?.enabled!==true||
    typeof workService?.list!=='function'||typeof workService?.get!=='function'||
    typeof memoryService?.search!=='function'||typeof grantsForSubject!=='function')
  return unused
 const gate=createAccessGate(access,fetchKeys?{fetchImpl:fetchKeys}:{})
 async function actorFor(request,operatorOnly=false){
  const identity=await gate(request,operatorOnly)
  if(identity?.status!==200||identity.identity?.kind==='service'||
     !id(identity.identity?.subject))deny()
  const grants=await grantsForSubject(identity.identity.subject)
  if(!exact(grants,['allowedProjectIds','allowedMemoryScopes'])||
     !Array.isArray(grants.allowedProjectIds)||grants.allowedProjectIds.length>25||
     !Array.isArray(grants.allowedMemoryScopes)||grants.allowedMemoryScopes.length>25||
     grants.allowedMemoryScopes.some(scope=>!exact(scope,['scope','ownerId'])||
       !MEMORY_SCOPES.has(scope.scope)))deny()
  const actor=normalizeActor({
   principalId:'access:'+createHash('sha256').update(identity.identity.subject).digest('hex'),
   allowedProjectIds:grants.allowedProjectIds,
   allowedMemoryScopes:grants.allowedMemoryScopes,
   allowedAgentIds:[],
  })
  if(actor.allowedProjectIds.length!==new Set(actor.allowedProjectIds).size||
     actor.allowedMemoryScopes.length!==
      new Set(actor.allowedMemoryScopes.map(s=>s.scope+':'+s.ownerId)).size)deny()
  return actor
 }
 async function guarded(request,fn){
  try{return await fn(await actorFor(request))}catch{deny()}
 }
 const canCreateTasks=taskWriter?.enabled===true&&typeof taskWriter.create==='function'
 return Object.freeze({
  enabled:true,
  canCreateTasks,
  /**
   * New task in a project the signed-in operator is granted. Needs an
   * operator email AND a project grant; the task starts as 'ready' and is
   * never claimed, moved or run by Friday.
   */
  async createTask(request,input){
   if(!canCreateTasks)throw writeError('disabled')
   let actor
   try{actor=await actorFor(request,true)}catch{throw writeError('denied')}
   if(!exact(input,['projectId','title','objective','requestId'],['projectId','title','requestId'])||
      !id(input.projectId)||!id(input.requestId)||
      !cleanString(input.title,TITLE_MAX)||
      (input.objective!==undefined&&input.objective!==''&&!cleanString(input.objective,OBJECTIVE_MAX)))
    throw writeError('invalid')
   if(!actor.allowedProjectIds.includes(input.projectId))throw writeError('denied')
   const title=input.title.trim()
   const objective=typeof input.objective==='string'&&input.objective.trim()?input.objective.trim():title
   const inputFingerprint=createHash('sha256')
    .update(JSON.stringify({projectId:input.projectId,title,objective})).digest('hex')
   let row
   try{
    row=await taskWriter.create({projectId:input.projectId,title,objective,
     principalId:actor.principalId,requestId:input.requestId,inputFingerprint})
   }catch(error){throw writeError(error?.code==='conflict'?'conflict':'unavailable')}
   try{return safeTask(row,actor.allowedProjectIds,input.projectId)}
   catch{throw writeError('unavailable')}
  },
  async listTasks(request,input){
   return guarded(request,async actor=>{
    if(!exact(input,['projectId','limit'],['projectId'])||
       !id(input.projectId)||!actor.allowedProjectIds.includes(input.projectId))deny()
    const limit=input.limit===undefined?20:input.limit
    if(!int(limit,25))deny()
    const rows=await workService.list({actor,projectId:input.projectId,limit})
    if(!Array.isArray(rows)||rows.length>limit)deny()
    return rows.map(row=>safeTask(row,actor.allowedProjectIds,input.projectId))
   })
  },
  async getTask(request,input){
   return guarded(request,async actor=>{
    if(!exact(input,['workItemId'])||!id(input.workItemId))deny()
    const row=await workService.get({actor,workItemId:input.workItemId})
    if(row?.id!==input.workItemId)deny()
    return safeTask(row,actor.allowedProjectIds)
   })
  },
  async searchMemory(request,input){
   return guarded(request,async actor=>{
    if(!exact(input,['scopes','query','limit'],['scopes']))deny()
    const query=input.query===undefined?'':input.query
    const limit=input.limit===undefined?20:input.limit
    if(typeof query!=='string'||query.length>128||forbidden.test(query)||
       !int(limit,20))deny()
    const requested=checkedScopes(input.scopes,actor)
    const rows=await memoryService.search({actor,scopes:input.scopes,query,limit})
    if(!Array.isArray(rows)||rows.length>limit)deny()
    const output=rows.map(row=>safeMemory(row,actor.allowedProjectIds,requested,query))
    if(output.reduce((sum,row)=>sum+row.content.length,0)>8000)deny()
    return output
   })
  },
 })
}
