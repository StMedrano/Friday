import test from 'node:test'
import assert from 'node:assert/strict'
import {createMemoryService,createSessionMemoryStore} from './memory-service.mjs'
const actor={principalId:'alice',allowedProjectIds:['project-1'],allowedMemoryScopes:[
 {scope:'global',ownerId:'friday'}, {scope:'organization',ownerId:'techtactics'},
 {scope:'project',ownerId:'project-1'}, {scope:'group',ownerId:'engineers'},
 {scope:'agent',ownerId:'coder'}, {scope:'task',ownerId:'task-1'},
 {scope:'session',ownerId:'session-1'}
],allowedAgentIds:[]}
const durable=[
 {id:'m1',scope:'project',ownerId:'project-1',projectId:'project-1',content:'architecture readme',provenance:'operator'},
 {id:'m2',scope:'project',ownerId:'project-2',projectId:'project-2',content:'secret other project',provenance:'operator'},
 {id:'m3',scope:'group',ownerId:'engineers',content:'coding standards',provenance:'operator'}
]
const calls={put:[],search:[],get:[]}
const repository={
 async workProjectId(id){return id==='task-1'?'project-1':null},
 async memoryPut(row){calls.put.push(row);return {...row,id:'new-record'}},
 async memoryGet(id){calls.get.push(id);return durable.find(m=>m.id===id)||null},
 async memorySearch(filter){calls.search.push(filter);return durable.filter(m=>m.scope===filter.scope && m.ownerId===filter.ownerId)}
}
const service=createMemoryService({repository})
test('six durable scopes can be written only if explicitly granted',async()=>{
 for(const scope of ['global','organization','project','group','agent','task']){
  const ownerId=actor.allowedMemoryScopes.find(s=>s.scope===scope).ownerId
  const record=await service.put({actor,scope,ownerId,content:'approved note',provenance:'operator',requestId:'req-'+scope})
  assert.equal(record.scope,scope)
 }
 assert.equal(calls.put.length,6)
 await assert.rejects(service.put({actor,scope:'project',ownerId:'project-2',content:'x',provenance:'operator',requestId:'cross'}),e=>e.kind==='not-authorized')
})
test('memory search intersects exact authorized scopes and project access',async()=>{
 const result=await service.search({actor,scopes:[{scope:'project',ownerId:'project-2'},{scope:'project',ownerId:'project-1'},{scope:'group',ownerId:'engineers'}],query:'',limit:10})
 assert.deepEqual(result.map(m=>m.id),['m1','m3'])
 const before=calls.search.length
 assert.deepEqual(await service.search({actor:{...actor,allowedMemoryScopes:[]},scopes:[{scope:'global',ownerId:'friday'}],query:'',limit:10}),[])
 assert.equal(calls.search.length,before)
 await assert.rejects(service.get({actor,memoryId:'m2'}),e=>e.kind==='not-found')
})
test('session writes never reach DB and expire on injected clock',async()=>{
 let now=5000
 const store=createSessionMemoryStore({now:()=>now,maxTtlMs:2000,maxChars:120})
 const sessionService=createMemoryService({repository,sessionStore:store})
 const before=calls.put.length
 const record=await sessionService.put({actor,scope:'session',ownerId:'session-1',content:'temporary detail',provenance:'operator',requestId:'session-request'})
 assert.equal(record.scope,'session')
 assert.equal(calls.put.length,before)
 assert.equal((await sessionService.search({actor,scopes:[{scope:'session',ownerId:'session-1'}],query:'temporary'})).length,1)
 assert.equal((await sessionService.search({actor:{...actor,principalId:'mallory'},scopes:[{scope:'session',ownerId:'session-1'}],query:'temporary'})).length,0)
 now=8000
 assert.equal((await sessionService.search({actor,scopes:[{scope:'session',ownerId:'session-1'}],query:'temporary'})).length,0)
})
test('malformed, sensitive or over-limit inputs fail closed',async()=>{
 await assert.rejects(service.put({actor,scope:'project',ownerId:'project-1',content:'authorization: Bearer private-token',provenance:'operator',requestId:'bad'}),e=>e.kind==='invalid-input')
 await assert.rejects(service.search({actor,scopes:[],query:'x'.repeat(257)}),e=>e.kind==='invalid-input')
 await assert.rejects(service.search({actor,scopes:[],query:'hi',limit:1000}),e=>e.kind==='invalid-input')
})