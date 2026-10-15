import test from 'node:test'
import assert from 'node:assert/strict'
import {validateWorkActorBindings,resolveTrustedWorkActor} from './actor-bindings.mjs'
import {createWorkService} from './work-service.mjs'

const policy=()=>({schemaVersion:'1',bindings:[{email:'owner@example.test',principalId:'owner-fixture',projects:[{projectId:'project-a',agentIds:['coder']},{projectId:'project-b',agentIds:['reviewer']}]}]})
const identity={ok:true,email:'owner@example.test',operator:false}
test('verified identity gets only its explicitly selected project and no memory permissions',()=>{
 const actor=resolveTrustedWorkActor({identity,projectId:'project-a',policy:policy()})
 assert.deepEqual(actor,{principalId:'owner-fixture',allowedProjectIds:['project-a'],allowedAgentIds:['coder'],allowedMemoryScopes:[]})
 actor.allowedProjectIds.push('project-private');actor.allowedAgentIds.push('admin')
 assert.deepEqual(resolveTrustedWorkActor({identity,projectId:'project-a',policy:policy()}).allowedAgentIds,['coder'])
})
test('unconfigured, unsigned, unlisted, wrong-project and spoofed authority fail closed',()=>{
 const input={identity,projectId:'project-a',policy:policy()}
 for(const patch of [
  {identity:null},{identity:{email:identity.email}},{identity:{ok:false,email:identity.email}},
  {identity:{ok:true,email:'other@example.test',operator:true,groups:['project-a']}},
  {policy:null},{policy:{schemaVersion:'1',bindings:[]}},{projectId:'project-private'},
  {actor:{principalId:'admin'}},{allowedProjectIds:['project-private']},
 ])assert.throws(()=>resolveTrustedWorkActor({...input,...patch}),error=>error.kind==='not-authorized'&&!error.message.includes('owner@example'))
})
test('ambiguous, oversized or privilege-bearing policy rejects entirely',()=>{
 const cases=[]
 let value=policy();value.bindings.push({...value.bindings[0],email:'OWNER@example.test'});cases.push(value)
 value=policy();value.bindings[0].projects.push({...value.bindings[0].projects[0]});cases.push(value)
 value=policy();value.bindings[0].projects[0].agentIds=['coder',' coder '];cases.push(value)
 value=policy();value.bindings[0].projects[0].memoryScopes=[{scope:'global',ownerId:'all'}];cases.push(value)
 value=policy();value.bindings[0].tools=['shell'];cases.push(value)
 value=policy();value.bindings[0].principalId='';cases.push(value)
 cases.push({...policy(),schemaVersion:'2'},{...policy(),bindings:new Array(101).fill(policy().bindings[0])})
 for(const item of cases)assert.throws(()=>validateWorkActorBindings(item))
})
test('policy canonicalizes explicit values and returns defensive data',()=>{
 const value=policy();value.bindings[0].email=' Owner@Example.Test '
 const normalized=validateWorkActorBindings(value)
 assert.equal(normalized.bindings[0].email,'owner@example.test')
 value.bindings[0].projects[0].agentIds.push('not-granted')
 assert.deepEqual(normalized.bindings[0].projects[0].agentIds,['coder'])
 assert.equal(resolveTrustedWorkActor({identity:{...identity,email:'OWNER@example.test'},projectId:'project-a',policy:normalized}).principalId,'owner-fixture')
})
test('mapped assignment eligibility cannot bypass the existing agent authorizer',async()=>{
 let writes=0
 const service=createWorkService({repository:{get:async()=>({id:'work-a',projectId:'project-a'}),claim:async()=>{writes++;return {}}}})
 const actor=resolveTrustedWorkActor({identity,projectId:'project-a',policy:policy()})
 await assert.rejects(service.claim({actor,workItemId:'work-a',agentId:'coder',runId:'run-a',expectedVersion:1,leaseSeconds:60,requestId:'fixture-request'}),error=>error.kind==='not-authorized')
 assert.equal(writes,0)
})
