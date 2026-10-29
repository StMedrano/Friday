import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectTaskAccess} from './project-access.mjs'
const owner={email:'owner@example.test',principalId:'fixture-owner'}
const identity={ok:true,email:owner.email}
const row={id:'task-a',projectId:'project-a',title:'Test task',objective:'Verify persistence',acceptanceCriteria:[],status:'ready',version:1}
function setup(){
 let projects=[{id:'project-a',name:'Fixture project'}],rows=[],writes=0,reads=0
 const repository={listProjects:async()=>{reads++;return projects},list:async()=>rows,create:async input=>{writes++;const saved={...row,...input};rows.push(saved);return saved}}
 return {access:createProjectTaskAccess({repository,owner}),repository,setProjects:v=>projects=v,setRows:v=>rows=v,counts:()=>({reads,writes})}
}
test('owner resolves only provisioned catalog projects and create/list survives service recreation',async()=>{
 const s=setup()
 assert.deepEqual(await s.access.projects(identity),[{id:'project-a',name:'Fixture project'}])
 const input={title:row.title,objective:row.objective,acceptanceCriteria:[],requestId:'request-a'}
 const result=await s.access.create(identity,'project-a',input)
 assert.deepEqual(Object.keys(result).sort(),Object.keys(row).sort())
 assert.deepEqual(await createProjectTaskAccess({repository:s.repository,owner}).list(identity,'project-a'),[row])
 assert.equal(s.counts().writes,1)
})
test('unsigned, unlisted and group/operator claims cannot read catalog or write',async()=>{
 for(const bad of [null,{email:owner.email},{ok:false,email:owner.email},{ok:true,email:'other@example.test',operator:true,groups:['project-a']}]){
  const s=setup();await assert.rejects(s.access.projects(bad),e=>e.kind==='not-authorized');assert.deepEqual(s.counts(),{reads:0,writes:0})
 }
 const s=setup();await assert.rejects(s.access.create(identity,'project-private',{title:'x'}),e=>e.kind==='not-authorized');assert.equal(s.counts().writes,0)
})
test('catalog removal, malformed/oversized/duplicate catalog and cross-project results fail closed',async()=>{
 for(const projects of [null,[{id:'project-a',name:''}],[{id:'*',name:'All'}],[{id:'project-a',name:'A'},{id:'project-a',name:'B'}],Array(51).fill({id:'a',name:'A'})]){
  const s=setup();s.setProjects(projects);await assert.rejects(s.access.projects(identity),e=>e.kind==='storage-unavailable')
 }
 const s=setup();s.setRows([{...row,projectId:'private'}]);await assert.rejects(s.access.list(identity,'project-a'),e=>e.kind==='storage-unavailable')
 s.setProjects([]);await assert.rejects(s.access.list(identity,'project-a'),e=>e.kind==='not-authorized')
})
test('extra authority, invalid task, failed writes and malformed storage never return success',async()=>{
 const input={title:'Task',objective:'Objective',acceptanceCriteria:[],requestId:'request-a'}
 for(const patch of [{actor:'admin'},{projectId:'private'},{title:''},{acceptanceCriteria:'bad'},{requestId:''}]){
  const s=setup();await assert.rejects(s.access.create(identity,'project-a',{...input,...patch}),e=>e.kind==='invalid-input');assert.equal(s.counts().writes,0)
 }
 for(const bad of [null,{...row,status:'invented'}]){const s=setup();s.repository.create=async()=>bad;await assert.rejects(s.access.create(identity,'project-a',input),e=>e.kind==='storage-unavailable')}
 const s=setup();s.repository.create=async()=>{throw Error('PRIVATE database detail')};await assert.rejects(s.access.create(identity,'project-a',input),e=>e.kind==='storage-unavailable'&&!e.message.includes('PRIVATE'))
})
