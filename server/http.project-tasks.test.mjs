import test from 'node:test'
import assert from 'node:assert/strict'
import {createFridayServer} from './http.mjs'
import {createProjectTaskAccess} from './work/project-access.mjs'
async function fixture(options,check){
 let reads=0,writes=0,rows=options.seedRows||[]
 const repository={listProjects:async()=>{reads++;return [{id:'project-a',name:'Fixture'}]},list:async()=>rows,listPage:async({after})=>rows.filter(row=>!after||row.createdAt<after.createdAt||(row.createdAt===after.createdAt&&row.id<after.id)).slice(0,51),create:async input=>{writes++;const row={...input,id:'00000000-0000-4000-8000-000000000001',createdAt:'2026-10-17T12:00:00.000000Z',status:'ready',version:1};rows.push(row);return row}}
 const server=createFridayServer({config:{mode:'live',ai:{enabled:false},access:{enabled:true,publicOrigin:'https://friday.example'}},verifyAccessImpl:async()=>({ok:true,email:'owner@example.test'}),projectTasks:createProjectTaskAccess({repository,owner:{email:'owner@example.test',principalId:'owner-fixture'}}),...options})
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
 try{await check('http://127.0.0.1:'+server.address().port,()=>({reads,writes}))}finally{await new Promise(r=>server.close(r))}
}
const input={title:'Fixture task',objective:'Verify persistence',acceptanceCriteria:[],requestId:'request-a'}
const post=(base,body=input,origin='https://friday.example')=>fetch(base+'/api/projects/project-a/tasks',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)})

test('scoped GET pages accept one cursor only and reject cross-project or malformed continuation',async()=>{
 const seedRows=Array.from({length:51},(_,i)=>({id:'00000000-0000-4000-8000-'+String(100-i).padStart(12,'0'),createdAt:'2026-10-17T12:00:00.000000Z',projectId:'project-a',title:'Task '+i,objective:'Goal',acceptanceCriteria:[],status:'ready',version:1}))
 await fixture({seedRows},async base=>{
  const first=await (await fetch(base+'/api/projects/project-a/tasks')).json();assert.equal(first.tasks.length,50);assert.ok(first.nextCursor)
  const next=await fetch(base+'/api/projects/project-a/tasks?cursor='+first.nextCursor);assert.equal(next.status,200)
  const last=await next.json();assert.equal(last.tasks.length,1);assert.equal(last.nextCursor,null)
  for(const query of ['cursor=','cursor=bad','cursor='+first.nextCursor+'&cursor='+first.nextCursor,'limit=999'])assert.equal((await fetch(base+'/api/projects/project-a/tasks?'+query)).status,400)
  assert.equal((await fetch(base+'/api/projects/private/tasks?cursor='+first.nextCursor)).status,403)
  assert.equal((await fetch(base+'/api/projects?cursor='+first.nextCursor)).status,400)
 })
})
test('verified owner can list projects, create a task and reload persisted result with projected fields',async()=>{
 await fixture({},async base=>{
  const catalog=await fetch(base+'/api/projects');assert.equal(catalog.status,200);assert.equal(catalog.headers.get('cache-control'),'no-store')
  assert.equal((await post(base)).status,201)
  const result=await (await fetch(base+'/api/projects/project-a/tasks')).json();assert.equal(result.tasks[0].title,input.title);assert.equal(result.tasks[0].principalId,undefined)
 })
})
test('denied identity, absent Access, absent runtime, unknown project and cross origin cannot write',async()=>{
 for(const options of [{verifyAccessImpl:async()=>({ok:false,status:401})},{verifyAccessImpl:async()=>({ok:true,email:'stranger@example.test',operator:true})},{projectTasks:null},{config:{mode:'mock',ai:{enabled:false},access:{enabled:false}}}])await fixture(options,async(base,counts)=>{assert.ok([401,403,503].includes((await post(base)).status));assert.deepEqual(counts(),{reads:0,writes:0})})
 await fixture({},async(base,counts)=>{
  assert.equal((await post(base,input,'https://evil.example')).status,403)
  assert.equal((await post(base,input,'')).status,403)
  assert.equal((await fetch(base+'/api/projects/private/tasks')).status,403)
  assert.equal((await post(base,{...input,actor:'admin'})).status,400)
  assert.equal((await fetch(base+'/api/projects?owner=admin')).status,400)
  assert.equal(counts().writes,0)
 })
})

test('write failures are sanitized and project writes share the per-identity resource guard',async()=>{
 await fixture({projectTasks:{create:async()=>{throw Error('PRIVATE credential')}}},async base=>{
  const result=await post(base);assert.equal(result.status,503);assert.equal((await result.text()).includes('PRIVATE'),false)
 })
 await fixture({},async(base,counts)=>{
  for(let i=0;i<20;i++)assert.equal((await post(base,{...input,requestId:'request-'+i})).status,201)
  assert.equal((await post(base,{...input,requestId:'denied-quota'})).status,429)
  assert.equal(counts().writes,20)
 })
})
