import {createOwnerWorkBindings,resolveTrustedWorkActor} from './actor-bindings.mjs'
import {createWorkService} from './work-service.mjs'
import {safeWorkError} from './validation.mjs'
import {parseTaskCursor,encodeTaskCursor,validateTaskPage} from './task-pagination.mjs'
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(v)
function projectCatalog(rows){
 if(!Array.isArray(rows)||rows.length>50)throw safeWorkError('storage-unavailable')
 const seen=new Set()
 return rows.map(row=>{
  if(!row||!id(row.id)||seen.has(row.id)||typeof row.name!=='string'||!row.name.trim()||row.name.length>160)throw safeWorkError('storage-unavailable')
  seen.add(row.id);return {id:row.id,name:row.name}
 })
}
function task(row,projectId){
 if(!row||!id(row.id)||row.projectId!==projectId||typeof row.title!=='string'||!row.title.trim()||row.title.length>160||typeof row.objective!=='string'||!row.objective.trim()||row.objective.length>4000||!Array.isArray(row.acceptanceCriteria)||row.acceptanceCriteria.length>50||row.acceptanceCriteria.some(x=>typeof x!=='string'||x.length>500)||!['ready','in_progress','blocked','review','completed','cancelled'].includes(row.status)||!Number.isSafeInteger(row.version)||row.version<1)throw safeWorkError('storage-unavailable')
 return {id:row.id,projectId,title:row.title,objective:row.objective,acceptanceCriteria:[...row.acceptanceCriteria],status:row.status,version:row.version}
}
// Injection is server-owned. Never create this adapter from request data.
// No bootstrap/env wiring: local fixtures only until storage rollout is reviewed.
export function createProjectTaskAccess({repository,owner}){
 const emptyPolicy=createOwnerWorkBindings({...owner,projectIds:[]})
 const ownerEmail=emptyPolicy.bindings[0].email
 const service=createWorkService({repository})
 function verify(identity){if(identity?.ok!==true||typeof identity.email!=='string'||identity.email.trim().toLowerCase()!==ownerEmail)throw safeWorkError('not-authorized')}
 async function catalog(identity){
  verify(identity)
  try{return projectCatalog(await repository.listProjects())}catch{throw safeWorkError('storage-unavailable')}
 }
 async function actor(identity,projectId){
  const projects=await catalog(identity)
  return resolveTrustedWorkActor({identity,projectId,policy:createOwnerWorkBindings({...owner,projectIds:projects.map(x=>x.id)})})
 }
 return Object.freeze({
  projects:catalog,
  async page(identity,projectId,cursor){
   const scoped=await actor(identity,projectId)
   const after=parseTaskCursor(cursor,projectId)
   try{
    const rows=validateTaskPage(await service.listPage({actor:scoped,projectId,cursor}),after)
    // Validate the lookahead record too; never partially accept malformed storage.
    const projected=rows.map(row=>task(row,projectId))
    return {tasks:projected.slice(0,50),nextCursor:rows.length>50?encodeTaskCursor(projectId,rows[49]):null}
   }catch(error){throw safeWorkError(error.kind==='invalid-input'?'invalid-input':'storage-unavailable')}
  },
  async list(identity,projectId){
   const scoped=await actor(identity,projectId)
   try{
    const rows=await service.list({actor:scoped,projectId,limit:50})
    if(!Array.isArray(rows)||rows.length>50)throw Error()
    const results=rows.map(row=>task(row,projectId))
    if(new Set(results.map(row=>row.id)).size!==results.length)throw Error()
    return results
   }catch{throw safeWorkError('storage-unavailable')}
  },
  async create(identity,projectId,input){
   const scoped=await actor(identity,projectId)
   const keys=['title','objective','acceptanceCriteria','requestId']
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))throw safeWorkError('invalid-input')
   try{return task(await service.create({actor:scoped,projectId,...input}),projectId)}
   catch(error){throw safeWorkError(['invalid-input','idempotency-conflict'].includes(error.kind)?error.kind:'storage-unavailable')}
  },
 })
}
