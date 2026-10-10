const kinds=new Set(['invalid-input','not-authorized','not-found','version-conflict','lease-conflict','lease-expired','storage-unavailable','idempotency-conflict'])
export function safeWorkError(kind){
 const e=new Error('Friday shared work unavailable')
 e.name='FridayWorkError'
 e.kind=kinds.has(kind)?kind:'storage-unavailable'
 return e
}
function fail(kind='invalid-input'){throw safeWorkError(kind)}
function record(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail()
}
const forbidden=/(-----BEGIN [\w ]*PRIVATE KEY-----|authorization\s*[:=]|bearer\s+[\w.-]{6,}|[\w]*(?:api_key|secret|password|token)[\w]*\s*=|sk-[\w-]{8,})/i
function string(value,max,{empty=false}={}){
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||forbidden.test(value))fail()
 return value.trim()
}
function id(x){return string(x,128)}
function strArray(xs){if(!Array.isArray(xs)||xs.length>50)fail();return xs.map(x=>string(x,500))}
function int(n,min,max){if(!Number.isSafeInteger(n)||n<min||n>max)fail();return n}
function requestId(value){return id(value)}
export function validateWorkCreate(input){
 const fields=['projectId','title','objective','acceptanceCriteria','requestId']
 record(input,fields)
 return {projectId:id(input.projectId),title:string(input.title,160),objective:string(input.objective,4000),acceptanceCriteria:strArray(input.acceptanceCriteria),requestId:requestId(input.requestId)}
}
export function validateClaim(input){
 record(input,['agentId','runId','expectedVersion','leaseSeconds','requestId'])
 return {agentId:id(input.agentId),runId:id(input.runId),expectedVersion:int(input.expectedVersion,1,Number.MAX_SAFE_INTEGER),leaseSeconds:int(input.leaseSeconds,60,900),...(input.requestId===undefined?{}:{requestId:requestId(input.requestId)})}
}
function packet(input,fields,required){
 record(input,fields)
 for(const key of required)if(input[key]===undefined)fail()
 const result={}
 for(const [key,value] of Object.entries(input)){
  if(key==='summary')result[key]=string(value,2000)
  else if(key==='status') {if(!['ready','in_progress','blocked','review','completed','cancelled'].includes(value))fail();result[key]=value}
  else if(key==='recommendedNextCapability')result[key]=string(value,128)
  else if(Array.isArray(value))result[key]=strArray(value)
  else fail()
 }
 return result
}
export function validateCheckpoint(input){
 return packet(input,['summary','completed','remaining','blockers','artifacts','verification','decisions'],['summary','completed','remaining','blockers'])
}
export function validateHandoff(input){
 return packet(input,['summary','status','completed','remaining','blockers','decisions','artifactRefs','gitRefs','verification','recommendedNextCapability'],['summary','status','completed','remaining'])
}
export function validateMemoryWrite(input){
 record(input,['scope','ownerId','content','provenance','requestId'])
 if(!['global','organization','project','group','agent','task'].includes(input.scope))fail()
 return {scope:input.scope,ownerId:id(input.ownerId),content:string(input.content,4000),provenance:string(input.provenance,500),requestId:requestId(input.requestId)}
}
export function normalizeActor(actor){
 try {
  record(actor,['principalId','allowedProjectIds','allowedMemoryScopes','allowedAgentIds'])
  if(!Array.isArray(actor.allowedProjectIds)||!Array.isArray(actor.allowedMemoryScopes)||!Array.isArray(actor.allowedAgentIds))fail()
  const scopes=actor.allowedMemoryScopes.map(s=>{
   record(s,['scope','ownerId'])
   if(!['global','organization','project','group','agent','task','session'].includes(s.scope))fail()
   return {scope:s.scope,ownerId:id(s.ownerId)}
  })
  return {principalId:id(actor.principalId),allowedProjectIds:actor.allowedProjectIds.map(id),allowedMemoryScopes:scopes,allowedAgentIds:actor.allowedAgentIds.map(id)}
 }catch{fail('not-authorized')}
}