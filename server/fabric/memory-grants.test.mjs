import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveMemoryScopes} from './memory-grants.mjs'
const p=(scope,ownerId)=>({scope,ownerId})
const agentId='review-agent',groupId='engineering'
const grants=[p('project','project-a'),p('project','project-b'),p('group','engineering'),p('task','work-a'),p('agent',agentId),p('session','session-a')]
const actor={principalId:'operator-1',allowedProjectIds:['project-a','project-b'],allowedMemoryScopes:grants,allowedAgentIds:[agentId]}
const workItem={id:'work-a',projectId:'project-a'}
const assignment={agentId,groupId,allowedMemoryScopes:grants}
const serverCeilings={allowedMemoryScopes:grants,sessionOwnerByPrincipal:{'operator-1':'session-a'}}
const taskPolicy={allowedMemoryScopes:grants}
const input={actor,workItem,groupId,agentId,assignment,serverCeilings,taskPolicy,groupScopes:['project','group','task','agent','session']}
test('exact actor policy and work owner intersection excludes other project',()=>{
 const r=resolveMemoryScopes(input)
 assert.deepEqual(r,[p('agent',agentId),p('group',groupId),p('project','project-a'),p('session','session-a'),p('task','work-a')])
 assert.equal(r.some(x=>x.ownerId==='project-b'),false)
})
test('task/group/agent owners are taken only from trusted current identifiers',()=>{
 const r=resolveMemoryScopes({...input,assignment:{...assignment,allowedMemoryScopes:[...grants,p('group','another-group'),p('task','other-task'),p('agent','another-agent')]}})
 assert.equal(r.some(x=>['another-group','other-task','another-agent'].includes(x.ownerId)),false)
})
test('server and task policies and actor must all explicitly allow exact owner',()=>{
 for(const change of [
  {taskPolicy:{allowedMemoryScopes:[]}},
  {serverCeilings:{...serverCeilings,allowedMemoryScopes:[]}},
  {assignment:{...assignment,allowedMemoryScopes:[]}},
  {actor:{...actor,allowedMemoryScopes:[]}},
  {groupScopes:[]}
 ])assert.deepEqual(resolveMemoryScopes({...input,...change}),[])
})
test('unknown session owner, wrong principal and missing trusted project fail closed',()=>{
 const denied=resolveMemoryScopes({...input,serverCeilings:{allowedMemoryScopes:grants}})
 assert.equal(denied.some(x=>x.scope==='session'),false)
 assert.throws(()=>resolveMemoryScopes({...input,actor:{...actor,allowedProjectIds:['project-b']}}),e=>e.kind==='not-authorized')
 assert.throws(()=>resolveMemoryScopes({...input,actor:undefined}),e=>e.kind==='not-authorized')
})
test('wildcards do not grant memory and order is canonical',()=>{
 const wildcard=p('project','*')
 const a=resolveMemoryScopes({...input,actor:{...actor,allowedMemoryScopes:[...grants,wildcard]}})
 const b=resolveMemoryScopes({...input,assignment:{...assignment,allowedMemoryScopes:[...grants].reverse()}})
 assert.deepEqual(a,b)
 assert.equal(a.some(x=>x.ownerId==='*'),false)
})
