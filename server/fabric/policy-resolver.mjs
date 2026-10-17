import {normalizeActor} from '../work/validation.mjs'
import {FabricPolicyError} from './manifest-validation.mjs'
import {resolveSkillInstructions} from './skill-resolver.mjs'
import {resolveMemoryScopes} from './memory-grants.mjs'
const deny=(kind='not-authorized')=>{throw new FabricPolicyError(kind)}
const canonical=/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const isCap=x=>typeof x==='string'&&canonical.test(x)
// Phase 2C is advisory and only classifies explicitly read-only operations.
// Unknown verbs are approval-required even if a descriptor claims 'low' risk.
const readOnlyActions=new Set(['read','get','list','search','view','status','inspect','describe','query'])
function isReadOnlyCapability(capability){
 return readOnlyActions.has(capability.split('.').at(-1))
}

const arr=x=>Array.isArray(x)?x:[]
const uniqueSorted=xs=>[...new Set(xs)].sort()
function has(xs,value){return arr(xs).includes(value)}
function makeTrace(capability,decision,reason){return {capability,decision,reason}}
export function resolveEffectivePolicy({catalog,agent,actor,projectId,workItem,taskPolicy,serverCeilings}={}){
 let a
 try{a=normalizeActor(actor)}catch{deny()}
 if(!catalog?.groups||!catalog?.assignments||!catalog?.plugins||!catalog?.skills||
    !agent||agent.enabled!==true||typeof agent.id!=='string'||!a.allowedAgentIds.includes(agent.id)||
    !workItem||workItem.projectId!==projectId||!a.allowedProjectIds.includes(projectId))deny()
 const assignment=catalog.assignments[agent.id]
 if(!assignment||assignment.agentId!==agent.id)deny()
 const group=catalog.groups[assignment.groupId]
 if(!group)deny()
 if(!taskPolicy||!serverCeilings||!Array.isArray(serverCeilings.globalCapabilities)||
    !Array.isArray(serverCeilings.organizationCapabilities)||
    !Array.isArray(taskPolicy.allowedPluginCapabilities)||
    !serverCeilings.actorCapabilitiesByPrincipal||
    typeof serverCeilings.actorCapabilitiesByPrincipal!=='object')deny()
 const requiredSkills=[...arr(serverCeilings.requiredSkillIds),...arr(group.requiredSkills)]
 const optionalSkills=[...arr(group.optionalSkills),...arr(assignment.skills)]
 const approvedSkillIds=arr(taskPolicy.approvedSkillIds).filter(x=>has(serverCeilings.approvedSkillIds,x))
 const result=resolveSkillInstructions({
  catalog,requiredSkillIds:requiredSkills,optionalSkillIds:optionalSkills,
  taskRequestedSkillIds:arr(taskPolicy.taskRequestedSkillIds),approvedSkillIds,
 })
 const pluginByCap=new Map()
 for(const p of Object.values(catalog.plugins)){
  for(const c of arr(p.capabilities)){
   if(!isCap(c))continue
   // Defend the resolver as well as the catalog loader against capability
   // shadowing, including disabled high-risk versus enabled low-risk aliases.
   if(pluginByCap.has(c))deny('catalog-invalid')
   pluginByCap.set(c,[p])
  }
 }
 const allCaps=uniqueSorted([...pluginByCap.keys(),...arr(group.allowedPluginCapabilities),...arr(assignment.allowedPluginCapabilities)])
 const capTrace=[],caps=[]
 for(const capability of allCaps){
  if(!isCap(capability))continue
  const plugins=pluginByCap.get(capability)||[]
  let reason='denied',decision='denied'
  const isDenied=[
   serverCeilings.globalDeniedCapabilities,serverCeilings.organizationDeniedCapabilities,
   group.deniedPluginCapabilities,assignment.deniedPluginCapabilities,taskPolicy.deniedPluginCapabilities,
   serverCeilings.actorDeniedCapabilitiesByPrincipal?.[a.principalId]
  ].some(xs=>has(xs,capability))
  const allowed=[
   serverCeilings.globalCapabilities,serverCeilings.organizationCapabilities,
   group.allowedPluginCapabilities,assignment.allowedPluginCapabilities,
   taskPolicy.allowedPluginCapabilities,
   serverCeilings.actorCapabilitiesByPrincipal[a.principalId]
  ].every(xs=>has(xs,capability))
  if(isDenied)reason='explicit-deny'
  else if(!allowed)reason='missing-allow'
  else if(!plugins.some(p=>p.enabled===true))reason='plugin-disabled'
  else if(plugins.some(p=>p.enabled===true&&p.risk==='high')||!isReadOnlyCapability(capability)){
   reason='review-required';decision='approval-required'
  }else if(plugins.some(p=>p.enabled===true)){
   decision='allowed';reason='all-scopes-allowed';caps.push(capability)
  }
  capTrace.push(makeTrace(capability,decision,reason))
 }
 return {
  agentId:agent.id,groupId:group.id,policyHash:catalog.policyHash,
  skills:result.skills,skillOmissions:result.omissions,
  capabilities:caps,capabilityTrace:capTrace,
  memoryScopeRequests:resolveMemoryScopes({actor:a,workItem,groupId:group.id,agentId:agent.id,assignment,serverCeilings,taskPolicy,groupScopes:group.memoryScopes}),
  requiredProcessRules:uniqueSorted([...arr(serverCeilings.requiredProcessRules),...arr(group.requiredProcessRules)]),
 }
}
