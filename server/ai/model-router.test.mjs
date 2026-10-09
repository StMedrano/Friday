import test from 'node:test'
import assert from 'node:assert/strict'
import {rankEligibleModelTargets} from './model-router.mjs'

const target = (id, extras = {}) => ({
  descriptor: {
    id, provider:'nvidia', deployment:'hosted', billingClass:'free',
    capabilities:['general','coding'], supportsTools:false, supportsVision:false,
    enabled:true, ...extras,
  },
  providerConfig:{model:id},
})

test('only free, enabled, capable and healthy targets are eligible', () => {
  const all = [
    target('good'),target('paid',{billingClass:'paid'}),target('unknown',{billingClass:'unknown'}),
    target('off',{enabled:false}),target('wrong',{capabilities:['general']}),
    target('unhealthy'),target('tools',{supportsTools:true}),
  ]
  const eligible=rankEligibleModelTargets({targets:all,requirements:{capabilities:['coding']},healthById:{unhealthy:'unhealthy'}})
  assert.deepEqual(eligible.map(t=>t.descriptor.id),['good','tools'])
  assert.deepEqual(rankEligibleModelTargets({targets:all,requirements:{capabilities:['tool-use','coding']}}).map(t=>t.descriptor.id),['tools'])
})
test('local-only, vision and free-only cannot be bypassed by policy', () => {
  const targets=[target('cloud',{supportsVision:true}),target('local',{deployment:'local',supportsVision:true}),
    target('unknown-local',{deployment:'local',billingClass:'unknown',supportsVision:true})]
  const requirements={capabilities:['general'],privacy:'local-only',multimodal:true}
  assert.deepEqual(rankEligibleModelTargets({targets,requirements,policy:{freeOnly:false,allowPaidFallback:true,preferLocal:false}}).map(t=>t.descriptor.id),['local'])
})
test('deterministic source ordering with local preference',()=>{
  const targets=[target('host1'),target('local1',{deployment:'local'}),target('local2',{deployment:'local'}),target('host2')]
  const rank=()=>rankEligibleModelTargets({targets,requirements:{capabilities:['general']},policy:{preferLocal:true}}).map(t=>t.descriptor.id)
  assert.deepEqual(rank(),['local1','local2','host1','host2'])
  assert.deepEqual(rank(),rank())
  assert.deepEqual(rankEligibleModelTargets({targets,requirements:{capabilities:[]},policy:{preferLocal:false}}).map(t=>t.descriptor.id),['host1','local1','local2','host2'])
})
test('incomplete and invalid model declarations fail closed',()=>{
  const targets=[target('good'),target('bad',{capabilities:undefined}), target('odd',{billingClass:undefined}),target('tool',{supportsTools:undefined})]
  assert.deepEqual(rankEligibleModelTargets({targets,requirements:{capabilities:['general']}}).map(t=>t.descriptor.id),['good'])
  assert.deepEqual(rankEligibleModelTargets({targets,requirements:{capabilities:['unavailable']}}),[])
  assert.deepEqual(rankEligibleModelTargets({targets,requirements:{capabilities:['general'],privacy:'nonsense'}}),[])
})