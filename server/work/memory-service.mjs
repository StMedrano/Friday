import {randomUUID} from 'node:crypto'
import {normalizeActor,safeWorkError,validateMemoryWrite} from './validation.mjs'
const durableScopes=new Set(['global','organization','project','group','agent','task'])
const allScopes=new Set([...durableScopes,'session'])
function pair(scope,ownerId){return scope+':'+ownerId}
function permitted(actor,scope,ownerId){
 return actor.allowedMemoryScopes.some(p=>p.scope===scope&&p.ownerId===ownerId)&&
  (scope!=='project'||actor.allowedProjectIds.includes(ownerId))
}
function sanitizeResult(row){
 if(!row||typeof row!=='object'||typeof row.content!=='string'||row.content.length>4000 ||
  /(authorization\s*[:=]|bearer\s+[\w.-]{6,}|-----BEGIN|(?:api_key|secret|password|token)\s*=)/i.test(row.content))return null
 return {id:row.id,scope:row.scope,ownerId:row.ownerId,content:row.content,provenance:row.provenance,projectId:row.projectId}
}
export function createSessionMemoryStore({now=Date.now,maxTtlMs=3600000,maxChars=16000}={}){
 const records=new Map()
 function key(principalId,sessionId){return JSON.stringify([principalId,sessionId])}
 function active(principalId,sessionId){
  const k=key(principalId,sessionId)
  const items=(records.get(k)||[]).filter(m=>m.expiresAt>now())
  records.set(k,items)
  return items
 }
 return Object.freeze({
  put({principalId,sessionId,content,provenance}){
   if(content.length>maxChars)throw safeWorkError('invalid-input')
   const items=active(principalId,sessionId)
   while(items.length&&items.reduce((n,m)=>n+m.content.length,0)+content.length>maxChars)items.shift()
   const row={id:randomUUID(),scope:'session',ownerId:sessionId,content,provenance,principalId,expiresAt:now()+maxTtlMs}
   items.push(row)
   records.set(key(principalId,sessionId),items)
   return row
  },
  search({principalId,sessionId,query='',limit=20}){
   return active(principalId,sessionId).filter(m=>m.content.toLowerCase().includes(query.toLowerCase())).slice(0,limit)
  },
  get({principalId,sessionId,id}){return active(principalId,sessionId).find(m=>m.id===id)||null},
 })
}
export function createMemoryService({repository,sessionStore=createSessionMemoryStore()}={}){
 if(!repository)throw safeWorkError('storage-unavailable')
 async function checkTaskProject(a,scope,ownerId){
  if(scope!=='task')return null
  if(typeof repository.workProjectId!=='function')throw safeWorkError('not-authorized')
  const projectId=await repository.workProjectId(ownerId)
  if(!projectId||!a.allowedProjectIds.includes(projectId))throw safeWorkError('not-authorized')
  return projectId
 }
 function validateRequestScope(s){
  if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['scope','ownerId'].includes(k))||
   !allScopes.has(s.scope)||typeof s.ownerId!=='string'||!s.ownerId.trim()||s.ownerId.length>128)throw safeWorkError('invalid-input')
  return s
 }
 return Object.freeze({
  async put({actor,scope,ownerId,content,provenance,requestId}={}){
   const a=normalizeActor(actor)
   validateRequestScope({scope,ownerId})
   if(!permitted(a,scope,ownerId))throw safeWorkError('not-authorized')
   if(scope==='session'){
    // Use the same bounded sensitive-data checks, but never write a session row to Postgres.
    validateMemoryWrite({scope:'task',ownerId,content,provenance,requestId})
    return sanitizeResult(sessionStore.put({principalId:a.principalId,sessionId:ownerId,content,provenance}))
   }
   const valid=validateMemoryWrite({scope,ownerId,content,provenance,requestId})
   const projectId=await checkTaskProject(a,scope,ownerId) || (scope==='project'?ownerId:null)
   return sanitizeResult(await repository.memoryPut({...valid,principalId:a.principalId,projectId}))
  },
  async get({actor,memoryId,sessionId}={}){
   const a=normalizeActor(actor)
   if(typeof memoryId!=='string'||!memoryId.trim()||memoryId.length>128)throw safeWorkError('invalid-input')
   if(sessionId!==undefined){
    if(!permitted(a,'session',sessionId))throw safeWorkError('not-found')
    const record=sessionStore.get({principalId:a.principalId,sessionId,id:memoryId})
    if(!record)throw safeWorkError('not-found')
    return sanitizeResult(record)
   }
   const row=await repository.memoryGet(memoryId)
   if(!row||!permitted(a,row.scope,row.ownerId)||
      (row.projectId&&!a.allowedProjectIds.includes(row.projectId)))throw safeWorkError('not-found')
   await checkTaskProject(a,row.scope,row.ownerId)
   const sanitized=sanitizeResult(row)
   if(!sanitized)throw safeWorkError('not-found')
   return sanitized
  },
  async search({actor,scopes=[],query='',limit=20}={}){
   const a=normalizeActor(actor)
   if(!Array.isArray(scopes)||scopes.length>30||typeof query!=='string'||query.length>256||
      !Number.isInteger(limit)||limit<1||limit>20)throw safeWorkError('invalid-input')
   const out=[]
   const seen=new Set()
   for(const raw of scopes){
    const {scope,ownerId}=validateRequestScope(raw)
    if(!permitted(a,scope,ownerId)||seen.has(pair(scope,ownerId)))continue
    seen.add(pair(scope,ownerId))
    let rows
    if(scope==='session')rows=sessionStore.search({principalId:a.principalId,sessionId:ownerId,query,limit})
    else{
     const projectId=await checkTaskProject(a,scope,ownerId)||(scope==='project'?ownerId:null)
     rows=await repository.memorySearch({scope,ownerId,projectId,limit:100})
    }
    for(const row of rows||[]){
     if(row.scope!==scope||row.ownerId!==ownerId || (row.projectId&&!a.allowedProjectIds.includes(row.projectId)))continue
     if(!row.content?.toLowerCase().includes(query.toLowerCase()))continue
     const clean=sanitizeResult(row)
     if(clean)out.push(clean)
    }
   }
   let chars=0
   const output=[]
   for(const row of out){
    if(output.length===limit)break
    const remaining=8000-chars
    if(remaining<=0)break
    const content=row.content.slice(0,remaining)
    output.push({...row,content})
    chars+=content.length
   }
   return output
  }
 })
}