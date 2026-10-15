import {normalizeActor,safeWorkError} from './validation.mjs'

function exact(value,keys){
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
}
function array(value,max){if(!Array.isArray(value)||value.length>max)throw safeWorkError('invalid-input');return value}
function unique(values){if(new Set(values).size!==values.length)throw safeWorkError('invalid-input');return values}
function email(value){
 if(typeof value!=='string'||value.length>254)throw safeWorkError('invalid-input')
 const result=value.trim().toLowerCase()
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))throw safeWorkError('invalid-input')
 return result
}

// Internal server-owned configuration only. Never pass a request body as policy.
export function validateWorkActorBindings(value){
 if(!exact(value,['schemaVersion','bindings'])||value.schemaVersion!=='1')throw safeWorkError('invalid-input')
 const bindings=array(value.bindings,100).map(binding=>{
  if(!exact(binding,['email','principalId','projects']))throw safeWorkError('invalid-input')
  const projects=array(binding.projects,50).map(project=>{
   if(!exact(project,['projectId','agentIds']))throw safeWorkError('invalid-input')
   const actor=normalizeActor({principalId:binding.principalId,allowedProjectIds:[project.projectId],allowedAgentIds:array(project.agentIds,50),allowedMemoryScopes:[]})
   return {projectId:actor.allowedProjectIds[0],agentIds:unique(actor.allowedAgentIds)}
  })
  // Validate principal even when it has no project grants.
  const actor=normalizeActor({principalId:binding.principalId,allowedProjectIds:[],allowedAgentIds:[],allowedMemoryScopes:[]})
  unique(projects.map(project=>project.projectId))
  return {email:email(binding.email),principalId:actor.principalId,projects}
 })
 unique(bindings.map(binding=>binding.email))
 return {schemaVersion:'1',bindings}
}

export function resolveTrustedWorkActor(input){
 try {
  if(!exact(input,['identity','projectId','policy'])||input.identity?.ok!==true)throw Error()
  const verifiedEmail=email(input.identity.email)
  const policy=validateWorkActorBindings(input.policy)
  const binding=policy.bindings.find(item=>item.email===verifiedEmail)
  const project=binding?.projects.find(item=>item.projectId===input.projectId)
  if(!binding||!project)throw Error()
  return normalizeActor({principalId:binding.principalId,allowedProjectIds:[project.projectId],allowedAgentIds:[...project.agentIds],allowedMemoryScopes:[]})
 }catch{throw safeWorkError('not-authorized')}
}
