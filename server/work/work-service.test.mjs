import test from 'node:test'
import assert from 'node:assert/strict'
import {createWorkService} from './work-service.mjs'
const actor={principalId:'user-a',allowedProjectIds:['project-a'],allowedMemoryScopes:[],allowedAgentIds:['coder']}
const item={id:'work-1',projectId:'project-a',version:1,status:'ready'}
const claim={id:'claim-1',workItemId:'work-1',principalId:'user-a',agentId:'coder',runId:'run-1'}
const counts={get:0,claim:0}
const repo={
 async get(id){counts.get++;return id==='work-1'?item:{...item,id,projectId:'project-b'}},
 async getClaim(){return claim},
 async create(row){return {...row,id:'work-1',version:1}},
 async list(){return [item]},
 async claim(row){counts.claim++;return {status:'claimed',claimId:'claim-1',workVersion:2}},
 async renew(row){return {status:'renewed',workVersion:3}},
 async checkpoint(row){return {status:'appended',recordId:'cp-1',workVersion:3}},
 async handoff(row){return {status:'appended',recordId:'ho-1',workVersion:3}},
 async release(row){return {status:'released',workVersion:3}},
 async getLatestHandoff(){return {id:'ho-1',summary:'ready'}},
}
const service=createWorkService({repository:repo,agentAuthorizer:(a,id)=>id==='coder'})
test('trusted actor with project and agent authorization can claim and checkpoint',async()=>{
 const res=await service.claim({actor,workItemId:'work-1',agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds:120,requestId:'req-1'})
 assert.equal(res.status,'claimed')
 const checkpoint=await service.checkpoint({actor,claimId:'claim-1',runId:'run-1',expectedVersion:2,requestId:'cp-request',packet:{summary:'ok',completed:[],remaining:[],blockers:[]}})
 assert.equal(checkpoint.status,'appended')
})
test('invalid or unauthorized actor/project/agent is rejected before mutation',async()=>{
 const prev=counts.claim
 for(const a of [null,{...actor,allowedProjectIds:[]},{...actor,allowedAgentIds:[]}]){
  await assert.rejects(service.claim({actor:a,workItemId:'work-1',agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds:120}),e=>['not-authorized','not-found'].includes(e.kind))
 }
 await assert.rejects(service.claim({actor,workItemId:'work-2',agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds:120}),e=>e.kind==='not-found')
 await assert.rejects(service.claim({actor,workItemId:'work-1',agentId:'reviewer',runId:'run-1',expectedVersion:1,leaseSeconds:120}),e=>e.kind==='not-authorized')
 assert.equal(counts.claim,prev)
})
test('cross-actor claim mutation is blocked before forwarding',async()=>{
 const wrong={...actor,principalId:'user-b'}
 await assert.rejects(service.renew({actor:wrong,claimId:'claim-1',runId:'run-1',expectedVersion:2,leaseSeconds:120}),e=>e.kind==='not-authorized')
 await assert.rejects(service.release({actor,claimId:'claim-1',runId:'run-wrong',expectedVersion:2,nextStatus:'review'}),e=>e.kind==='not-authorized')
 await assert.rejects(service.handoff({actor,claimId:'claim-1',runId:'run-wrong',expectedVersion:2,requestId:'ho-req',packet:{summary:'good',status:'review',completed:[],remaining:[]}}),e=>e.kind==='not-authorized')
})
test('missing agentAuthorizer denies claims by default',async()=>{
 const blocked=createWorkService({repository:repo})
 await assert.rejects(blocked.claim({actor,workItemId:'work-1',agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds:120}),e=>e.kind==='not-authorized')
})