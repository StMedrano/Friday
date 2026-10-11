import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveEffectivePolicy} from './policy-resolver.mjs'
const id='code-review-agent'
const scope={scope:'project',ownerId:'project-a'}
const cap='github.repository.read',write='github.branch.write'
const group={id:'engineering',requiredSkills:['safe-code-review'],optionalSkills:[],allowedPluginCapabilities:[cap,write],deniedPluginCapabilities:[],memoryScopes:['project'],requiredProcessRules:['review-before-merge']}
const agent={id,name:'Code Review',enabled:true,model:{profile:'local-general'},tools:['ssh_read']}
const actor={principalId:'operator-1',allowedProjectIds:['project-a'],allowedMemoryScopes:[scope],allowedAgentIds:[id]}
const workItem={id:'work-a',projectId:'project-a',version:1,objective:'Review'}
const assignment={schemaVersion:'1',agentId:id,groupId:'engineering',skills:[],allowedPluginCapabilities:[cap,write],deniedPluginCapabilities:[],allowedMemoryScopes:[scope]}
const skills={'safe-code-review':{id:'safe-code-review',version:'1.0.0',body:'Review safely.',checksum:'sha-safe',source:'skill',dependencies:[]}}
const catalog={groups:{engineering:group},skills,plugins:{github:{id:'github',enabled:true,risk:'low',capabilities:[cap,write]}},assignments:{[id]:assignment},policyHash:'policy-v1'}
const all=[cap,write]
const serverCeilings={globalCapabilities:all,organizationCapabilities:all,actorCapabilitiesByPrincipal:{'operator-1':all},requiredSkillIds:[],approvedSkillIds:['safe-code-review'],globalDeniedCapabilities:[],organizationDeniedCapabilities:[],requiredProcessRules:[],allowedMemoryScopes:[scope]}
const taskPolicy={allowedPluginCapabilities:all,deniedPluginCapabilities:[],approvedSkillIds:['safe-code-review'],taskRequestedSkillIds:[],allowedMemoryScopes:[scope]}
const input={catalog,agent,actor,projectId:'project-a',workItem,taskPolicy,serverCeilings}
test('full exact intersection grants read descriptor but never a tool handle',()=>{
 const r=resolveEffectivePolicy(input)
 assert.deepEqual(r.capabilities,[cap])
 assert.deepEqual(r.skills.map(s=>s.id),['safe-code-review'])
 assert.equal(r.groupId,'engineering')
 assert.ok(!JSON.stringify(r).includes('ssh_read'))
 assert.ok(!Object.hasOwn(r,'execute'))
})
test('all six layers are required; denied and missing capabilities fail closed',()=>{
 for(const [layer,change] of [
  ['global',{serverCeilings:{...serverCeilings,globalCapabilities:[]}}],
  ['organization',{serverCeilings:{...serverCeilings,organizationCapabilities:[]}}],
  ['group',{catalog:{...catalog,groups:{engineering:{...group,allowedPluginCapabilities:[]}}}}],
  ['agent',{catalog:{...catalog,assignments:{[id]:{...assignment,allowedPluginCapabilities:[]}}}}],
  ['task',{taskPolicy:{...taskPolicy,allowedPluginCapabilities:[]}}],
  ['actor',{serverCeilings:{...serverCeilings,actorCapabilitiesByPrincipal:{}}}],
  ['explicit denial',{catalog:{...catalog,assignments:{[id]:{...assignment,deniedPluginCapabilities:[cap]}}}}]
 ]) {
  const result=resolveEffectivePolicy({...input,...change})
  assert.equal(result.capabilities.includes(cap),false,layer)
 }
})
test('plugin disabled or unknown and disconnected plugin produce no capability',()=>{
 const disabled={...catalog,plugins:{github:{...catalog.plugins.github,enabled:false}}}
 assert.deepEqual(resolveEffectivePolicy({...input,catalog:disabled}).capabilities,[])
 const noPlugin={...catalog,plugins:{}}
 assert.deepEqual(resolveEffectivePolicy({...input,catalog:noPlugin}).capabilities,[])
})
test('high-risk and write capabilities are approval-required descriptions only',()=>{
 const r=resolveEffectivePolicy(input)
 assert.equal(r.capabilityTrace.find(x=>x.capability===write).decision,'approval-required')
 assert.equal(r.capabilities.includes(write),false)
})
test('missing assignment, unregistered/disabled agent and forged project access denied',()=>{
 for(const change of [
  {catalog:{...catalog,assignments:{}}},
  {agent:{...agent,enabled:false}},
  {actor:{...actor,allowedAgentIds:[]}},
  {workItem:{...workItem,projectId:'project-b'}},
  {serverCeilings:{}}
 ])assert.throws(()=>resolveEffectivePolicy({...input,...change}),e=>e.kind==='not-authorized'||e.kind==='catalog-invalid')
})
test('wildcards or Unicode confusables never grant a declared capability',()=>{
 for(const value of ['github.repository.*','Github.repository.read','github.repository.réad']){
  const r=resolveEffectivePolicy({...input,taskPolicy:{...taskPolicy,allowedPluginCapabilities:[value]}})
  assert.equal(r.capabilities.includes(cap),false)
 }
})

test('read-only classification rejects operation verbs despite a low plugin risk label',()=>{
 const dangerous=['github.pull-request.merge','github.release.publish','github.branch.push','github.repo.admin','supabase.sql.execute','github.review.approve']
 for(const capability of dangerous){
  const maliciousCatalog={...catalog,plugins:{github:{id:'github',enabled:true,risk:'low',capabilities:[capability]}},
   groups:{engineering:{...group,allowedPluginCapabilities:[capability]}},
   assignments:{[id]:{...assignment,allowedPluginCapabilities:[capability]}}}
  const allGrant={...input,catalog:maliciousCatalog,
   serverCeilings:{...serverCeilings,globalCapabilities:[capability],organizationCapabilities:[capability],actorCapabilitiesByPrincipal:{'operator-1':[capability]}},
   taskPolicy:{...taskPolicy,allowedPluginCapabilities:[capability]}}
  const result=resolveEffectivePolicy(allGrant)
  assert.deepEqual(result.capabilities,[],capability)
  assert.equal(result.capabilityTrace.find(x=>x.capability===capability)?.decision,'approval-required',capability)
 }
})
