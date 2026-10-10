import test from 'node:test'
import assert from 'node:assert/strict'
import {buildWorkContinuation} from './continuation.mjs'
const actor={principalId:'a',allowedProjectIds:['p'],allowedMemoryScopes:[],allowedAgentIds:[]}
const workItem={id:'w',projectId:'p',objective:'Verify Friday',acceptanceCriteria:['Pass tests'],status:'review',version:4}
const workService={get:async()=>workItem,getLatestHandoff:async()=>({payload:{summary:'Ready for review',recommendedNextCapability:'code-review'}})}
const decisionService={listAccepted:async()=>[{id:'d1',state:'accepted',summary:'Use local models',provenance:'operator'},{id:'d2',state:'proposed',summary:'Change policy',provenance:'model'}]}
const memoryService={search:async()=>[{id:'m1',scope:'project',ownerId:'p',content:'Additional context',provenance:'verified'}]}
test('continuation packet preserves authoritative item and accepted decisions first',async()=>{
 const packet=await buildWorkContinuation({actor,workService,decisionService,memoryService,workItemId:'w',scopes:[{scope:'project',ownerId:'p'}]})
 assert.equal(packet.workItem.version,4)
 assert.equal(packet.latestHandoff.summary,'Ready for review')
 assert.deepEqual(packet.acceptedDecisions.map(x=>x.id),['d1'])
 assert.equal(packet.memory.length,1)
 assert.equal(JSON.stringify(packet).includes('Change policy'),false)
})
test('truncation cannot erase the authoritative item',async()=>{
 const packet=await buildWorkContinuation({actor,workService,decisionService,memoryService,workItemId:'w',scopes:[],maxChars:350})
 assert.equal(packet.workItem.objective,'Verify Friday')
 assert.ok(JSON.stringify(packet).length<=350)
})
test('stored credential-like handoff and accepted-decision strings are not emitted',async()=>{
 const poisonedWork={...workService,getLatestHandoff:async()=>({payload:{summary:'Authorization: Bearer token-placeholder'}})}
 const poisonedDecisions={listAccepted:async()=>[{state:'accepted',id:'d1',summary:'PASSWORD=secret-test',provenance:'operator'}]}
 const packet=await buildWorkContinuation({actor,workService:poisonedWork,decisionService:poisonedDecisions,memoryService,workItemId:'w',scopes:[]})
 assert.equal(packet.latestHandoff,null)
 assert.deepEqual(packet.acceptedDecisions,[])
 assert.equal(JSON.stringify(packet).includes('token-placeholder'),false)
 assert.equal(JSON.stringify(packet).includes('secret-test'),false)
})