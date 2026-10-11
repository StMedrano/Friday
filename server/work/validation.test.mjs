import test from 'node:test'
import assert from 'node:assert/strict'
import {validateWorkCreate,validateClaim,validateCheckpoint,validateHandoff,validateMemoryWrite,normalizeActor,safeWorkError} from './validation.mjs'
const actor={principalId:'user-1',allowedProjectIds:['project-a'],allowedMemoryScopes:[{scope:'project',ownerId:'project-a'}],allowedAgentIds:['coder']}
test('work creation validates shape and bounds',()=>{
 const ok=validateWorkCreate({projectId:'project-a',title:'Task',objective:'Make tests pass',acceptanceCriteria:['passing'],requestId:'req-1234'})
 assert.equal(ok.title,'Task')
 assert.throws(()=>validateWorkCreate({...ok,unexpected:true}),e=>e.kind==='invalid-input')
 assert.throws(()=>validateWorkCreate({...ok,title:'x'.repeat(161)}),e=>e.kind==='invalid-input')
})
test('claims require a bounded lease and identifiers',()=>{
 assert.equal(validateClaim({agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds:120}).leaseSeconds,120)
 for (const leaseSeconds of [0,59,901,1.2,NaN])assert.throws(()=>validateClaim({agentId:'coder',runId:'run-1',expectedVersion:1,leaseSeconds}),e=>e.kind==='invalid-input')
})
test('strict handoff and checkpoint validation rejects leaking fields or credentials',()=>{
 const pkt={summary:'checkpoint',completed:['one'],remaining:[],blockers:[],artifacts:[],verification:[]}
 assert.equal(validateCheckpoint(pkt).summary,'checkpoint')
 assert.equal(validateHandoff({status:'review',summary:'ready',completed:[],remaining:[],blockers:[],decisions:[],artifactRefs:[],gitRefs:[],verification:[],recommendedNextCapability:'code-review'}).status,'review')
 for (const evil of [{...pkt,Authorization:'Bearer private'}, {...pkt,summary:'Authorization: Bearer secret-token'}, {...pkt,summary:'-----BEGIN PRIVATE KEY-----'}, {...pkt,summary:'MY_API_KEY=foobar'}]) {
   assert.throws(()=>validateCheckpoint(evil),e=>e.kind==='invalid-input'&&!JSON.stringify(e).includes('private'))
 }
})
test('memory validation fails closed and actor is copied without unknown grants',()=>{
 const good=validateMemoryWrite({scope:'project',ownerId:'project-a',content:'System architecture summary',provenance:'operator',requestId:'req-1'})
 assert.equal(good.scope,'project')
 assert.throws(()=>validateMemoryWrite({...good,scope:'session'}),e=>e.kind==='invalid-input')
 assert.throws(()=>validateMemoryWrite({...good,content:'x'.repeat(4001)}),e=>e.kind==='invalid-input')
 assert.deepEqual(normalizeActor(actor).allowedProjectIds,['project-a'])
 assert.throws(()=>normalizeActor({...actor,admin:true}),e=>e.kind==='not-authorized')
 assert.equal(safeWorkError('unexpected exception').kind,'storage-unavailable')
})