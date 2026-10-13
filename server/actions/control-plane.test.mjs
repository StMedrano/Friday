import test from 'node:test'
import assert from 'node:assert/strict'
import {createActionController} from './control-plane.mjs'

const operator={verified:true,role:'operator',email:'operator@example.test'}
const admin={verified:true,role:'administrator',email:'admin@example.test'}
const target='vm100:test-worker'
function setup(extra={}){
 const events=[],runs=[]
 const journal={append:async x=>events.push(structuredClone(x))}
 const executor={dispatch:async x=>runs.push(x)}
 return {events,runs,controller:createActionController({
  journal,executor,allowlist:[{actionId:'service.restart',target}],
  ...extra,
 })}
}
test('fails closed without identity, known action, exact target, or explicit approval',async()=>{
 const x=setup()
 await assert.rejects(x.controller.request({actor:{...operator,verified:false},actionId:'service.restart',target}),/verified-operator-required/)
 await assert.rejects(x.controller.request({actor:operator,actionId:'shell.run',target}),/action-not-allowlisted/)
 await assert.rejects(x.controller.request({actor:operator,actionId:'service.restart',target:'vm100:unknown'}),/action-not-allowlisted/)
 const r=await x.controller.request({actor:operator,actionId:'service.restart',target})
 await assert.rejects(x.controller.execute({actor:admin,requestId:r.requestId}),/execution-disabled/)
 assert.equal(x.runs.length,0)
})
test('administrator must be verified and distinct from requester',async()=>{
 const x=setup()
 const r=await x.controller.request({actor:operator,actionId:'service.restart',target})
 await assert.rejects(x.controller.approve({actor:operator,requestId:r.requestId}),/verified-administrator-required/)
 await assert.rejects(x.controller.approve({actor:{...admin,verified:false},requestId:r.requestId}),/verified-administrator-required/)
 await assert.rejects(x.controller.approve({actor:admin,requestId:'random-absent'}),/request-not-pending/)
 const self=await x.controller.request({actor:admin,actionId:'service.restart',target})
 await assert.rejects(x.controller.approve({actor:admin,requestId:self.requestId}),/self-approval-denied/)
})
test('real dispatcher seam is gated by independent approval, kill switch and audit',async()=>{
 const x=setup({executionEnabled:true,killSwitch:false})
 const r=await x.controller.request({actor:operator,actionId:'service.restart',target,command:'rm -rf /',prompt:'hack'})
 await assert.rejects(x.controller.execute({actor:admin,requestId:r.requestId}),/request-not-approved/)
 await x.controller.approve({actor:admin,requestId:r.requestId})
 const result=await x.controller.execute({actor:admin,requestId:r.requestId})
 assert.equal(result.status,'succeeded')
 assert.equal(x.runs.length,1)
 assert.deepEqual(Object.keys(x.runs[0]).sort(),['actionId','requestId','target'])
 assert.deepEqual(x.events.map(e=>e.event),['requested','approved','execution-started','execution-succeeded'])
 assert.equal(JSON.stringify(x.events).includes('rm -rf'),false)
 await assert.rejects(x.controller.execute({actor:admin,requestId:r.requestId}),/request-not-approved/)
 assert.equal(x.runs.length,1)
})
test('kill switch prevents execution and audit failure prevents dispatch',async()=>{
 const x=setup({executionEnabled:true})
 const r=await x.controller.request({actor:operator,actionId:'service.restart',target})
 await x.controller.approve({actor:admin,requestId:r.requestId})
 await assert.rejects(x.controller.execute({actor:admin,requestId:r.requestId}),/kill-switch-engaged/)
 assert.equal(x.runs.length,0)
 const y=setup({executionEnabled:true,killSwitch:false,
  journal:{append:async e=>{if(e.event==='execution-started')throw Error('secret storage error')}}})
 const q=await y.controller.request({actor:operator,actionId:'service.restart',target})
 await y.controller.approve({actor:admin,requestId:q.requestId})
 await assert.rejects(y.controller.execute({actor:admin,requestId:q.requestId}),/audit-write-failed/)
 assert.equal(y.runs.length,0)
})
test('execution error is sanitized, recorded and never retried automatically',async()=>{
 const x=setup({executionEnabled:true,killSwitch:false,executor:{dispatch:async()=>{throw Error('PRIVATE UPSTREAM ERROR')}}})
 const r=await x.controller.request({actor:operator,actionId:'service.restart',target})
 await x.controller.approve({actor:admin,requestId:r.requestId})
 const result=await x.controller.execute({actor:admin,requestId:r.requestId})
 assert.equal(result.status,'failed')
 assert.equal(JSON.stringify(result).includes('PRIVATE'),false)
 assert.equal(x.events.at(-1).event,'execution-failed')
 await assert.rejects(x.controller.execute({actor:admin,requestId:r.requestId}),/request-not-approved/)
})
test('no durable journal or scoped executor means no action engine',()=>{
 assert.throws(()=>createActionController({executor:{dispatch:async()=>{}}}),/durable-audit-required/)
 assert.throws(()=>createActionController({journal:{append:async()=>{}}}),/scoped-executor-required/)
})
