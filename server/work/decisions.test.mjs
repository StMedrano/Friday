import test from 'node:test'
import assert from 'node:assert/strict'
import {createDecisionService} from './decisions.mjs'
const actor={principalId:'operator',allowedProjectIds:['friday'],allowedMemoryScopes:[],allowedAgentIds:[]}
const calls={reviews:0,inserts:0}
const repo={
 get:async()=>({id:'work-1',projectId:'friday'}),
 decisionInsert:async(data)=>{calls.inserts++;return {id:'decision-1',...data,state:'proposed'}},
 getDecision:async()=>({id:'decision-1',workItemId:'work-1',state:'proposed'}),
 reviewDecision:async(data)=>{calls.reviews++;return {status:'accepted',version:2}},
 listAcceptedDecisions:async()=>[{id:'decision-1',state:'accepted',summary:'Use Postgres',provenance:'operator'}],
 artifactInsert:async(data)=>({id:'artifact-1',...data}),
}
test('proposals are not automatically accepted and review requires trusted permission',async()=>{
 const service=createDecisionService({repository:repo})
 const proposed=await service.propose({actor,workItemId:'work-1',summary:'Use Postgres',provenance:'operator',requestId:'req-1'})
 assert.equal(proposed.state,'proposed')
 await assert.rejects(service.review({actor,decisionId:'decision-1',verdict:'accepted',expectedVersion:1}),e=>e.kind==='not-authorized')
 assert.equal(calls.reviews,0)
 const reviewed=await createDecisionService({repository:repo,reviewAuthorizer:()=>true}).review({actor,decisionId:'decision-1',verdict:'accepted',expectedVersion:1})
 assert.equal(reviewed.status,'accepted')
})
test('decision and artifact payloads reject credential-looking input and arbitrary refs',async()=>{
 const service=createDecisionService({repository:repo})
 await assert.rejects(service.propose({actor,workItemId:'work-1',summary:'Authorization: Bearer private-string',provenance:'operator',requestId:'req2'}),e=>e.kind==='invalid-input')
 await assert.rejects(service.attachArtifactMetadata({actor,workItemId:'work-1',gitRef:'../../../etc/passwd',artifactRef:'ref',requestId:'req2'}),e=>e.kind==='invalid-input')
 await assert.rejects(service.attachArtifactMetadata({actor,workItemId:'work-1',gitRef:'https://github.com/org/repo?token=secret',artifactRef:'ref',requestId:'req2'}),e=>e.kind==='invalid-input')
})
test('only same-project actors can read accepted decisions',async()=>{
 const service=createDecisionService({repository:repo})
 assert.equal((await service.listAccepted({actor,workItemId:'work-1'})).length,1)
 await assert.rejects(service.listAccepted({actor:{...actor,allowedProjectIds:[]},workItemId:'work-1'}),e=>e.kind==='not-found')
})