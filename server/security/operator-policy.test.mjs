import test from 'node:test'
import assert from 'node:assert/strict'
import {createOperatorRolePolicy} from './operator-policy.mjs'

const operator={subject:'operator-sub-123',email:'operator@example.test'}
const administrator={subject:'admin-sub-456',email:'admin@example.test'}
const viewer={subject:'viewer-sub-789',email:'viewer@example.test'}
const agent={subject:'agent-sub-987',email:'agent@example.test'}
const bindings=[
 {subject:operator.subject,role:'Operator',targets:['staging-canary']},
 {subject:administrator.subject,role:'Administrator',targets:['staging-canary']},
 {subject:viewer.subject,role:'Viewer',targets:['staging-canary']},
 {subject:agent.subject,role:'Friday Agent',targets:['staging-canary']},
]

test('role policy denies without an explicit trusted identity-to-role binding',()=>{
 for(const config of [undefined,{}, {bindings:[]}]){
  const policy=createOperatorRolePolicy(config)
  assert.equal(policy.permits(operator,'diagnostics.read','staging-canary'),false)
  assert.equal(policy.permits(operator,'action.propose','staging-canary'),false)
  assert.equal(policy.permits(operator,'action.approve','staging-canary'),false)
 }
})

test('Viewer can inspect only; Operator proposes; Administrator approves; Agent never changes action state',()=>{
 const p=createOperatorRolePolicy({bindings})
 const expectAccess=(who,rights)=>{
  for(const capability of ['diagnostics.read','action.propose','action.approve','action.execute']){
   assert.equal(p.permits(who,capability,'staging-canary'),rights.includes(capability),who.subject+' '+capability)
  }
 }
 expectAccess(viewer,['diagnostics.read'])
 expectAccess(operator,['diagnostics.read','action.propose'])
 expectAccess(administrator,['diagnostics.read','action.propose','action.approve'])
 expectAccess(agent,['diagnostics.read'])
})

test('signed identity subject and target must match exactly; client role fields are ignored',()=>{
 const p=createOperatorRolePolicy({bindings})
 for(const identity of [null,undefined,{}, {email:operator.email},
  {subject:'operator-sub-12'}, {subject:operator.subject+'-other'},
  {subject:operator.subject,kind:'service'},
  {subject:operator.subject,role:'Administrator',email:operator.email}]) {
  const grant=p.permits(identity,'action.approve','staging-canary')
  assert.equal(grant,false)
 }
 assert.equal(p.permits(operator,'action.propose','production'),false)
 assert.equal(p.permits(operator,'action.propose','staging-canary '),false)
 assert.equal(p.permits(operator,'action.propose','*'),false)
 assert.equal(p.permits(operator,'action.propose','staging-canary'),true)
 assert.equal(p.permits({subject:operator.subject,email:'different@example.test'},'action.propose','staging-canary'),true)
})

test('rejects malformed, duplicate, wildcard, unknown roles and nonexact policy structures atomically',()=>{
 const bad=[
  {bindings:[...bindings,bindings[0]]},
  {bindings:[{subject:'*',role:'Administrator',targets:['staging-canary']}]},
  {bindings:[{subject:'admin',role:'SuperAdmin',targets:['staging-canary']}]},
  {bindings:[{subject:'admin',role:'Administrator',targets:['*']}]},
  {bindings:[{subject:'admin',role:'Administrator',targets:[]}]},
  {bindings:[{subject:'admin',role:'Administrator',targets:['staging-canary','staging-canary']}]},
  {bindings:[{subject:'admin',role:'Administrator',targets:['staging-canary'],allowAll:true}]},
  {bindings:[{subject:'admin',role:'Administrator',targets:['../prod']}]},
  {bindings:bindings.slice(0,1),role:'Administrator'},
  {bindings:'Administrator'},
 ]
 for(const conf of bad){
  const p=createOperatorRolePolicy(conf)
  assert.equal(p.permits(administrator,'diagnostics.read','staging-canary'),false)
  assert.equal(p.permits(operator,'action.propose','staging-canary'),false)
 }
})

test('authorization refreshes effective grants from a validated immutable snapshot with no privilege inheritance',()=>{
 const p=createOperatorRolePolicy({bindings})
 bindings[0].role='Administrator'
 bindings[0].targets.push('production')
 assert.equal(p.permits(operator,'action.approve','staging-canary'),false)
 assert.equal(p.permits(operator,'action.propose','production'),false)
 bindings[0].role='Operator'
 bindings[0].targets.pop()
})
