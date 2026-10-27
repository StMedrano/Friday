import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseWorkReadRepository} from './read-only-repository.mjs'
import {createWorkService} from './work-service.mjs'
import {createMemoryService} from './memory-service.mjs'

const target='https://supabase.mytechtactics.com'
const config={baseUrl:target,readKey:'synthetic-read-only-key'}
const actor={principalId:'access:trusted',allowedProjectIds:['friday-ai-os'],
 allowedMemoryScopes:[{scope:'project',ownerId:'friday-ai-os'}],allowedAgentIds:[]}
const task={id:'w1',project_id:'friday-ai-os',title:'Plan',status:'ready',version:1}
const memory={id:'m1',scope:'project',owner_id:'friday-ai-os',project_id:'friday-ai-os',
 content:'Friday timeline',provenance:'fixture'}
function fixture(handler){
 const calls=[]
 const repo=createSupabaseWorkReadRepository({...config,
  fetchImpl:async(url,options)=>{
   calls.push({url,options})
   const rows=await handler(url,options)
   return new Response(JSON.stringify(rows),{status:200})
  }})
 return {repo,calls}
}
test('GET-only read repository selects bounded fields and is compatible with existing services',async()=>{
 const f=fixture(url=>url.includes('friday_work_items')?[task]:[memory])
 const work=createWorkService({repository:f.repo})
 const memories=createMemoryService({repository:f.repo})
 assert.deepEqual(await work.list({actor,projectId:'friday-ai-os',limit:5}),[{
  id:'w1',projectId:'friday-ai-os',title:'Plan',status:'ready',version:1,
 }])
 assert.deepEqual(await work.get({actor,workItemId:'w1'}),{
  id:'w1',projectId:'friday-ai-os',title:'Plan',status:'ready',version:1,
 })
 assert.deepEqual(await memories.search({actor,scopes:[{scope:'project',ownerId:'friday-ai-os'}],
  query:'timeline',limit:5}),[{
  id:'m1',scope:'project',ownerId:'friday-ai-os',projectId:'friday-ai-os',
  content:'Friday timeline',provenance:'fixture',
 }])
 assert.equal(f.calls.length,3)
 assert.ok(f.calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'))
 assert.ok(f.calls.every(c=>c.options.headers.apikey===config.readKey))
 assert.ok(f.calls.every(c=>c.options.headers.authorization==='Bearer '+config.readKey))
 assert.ok(f.calls.every(c=>!c.options.body))
 assert.ok(f.calls[0].url.includes('select=id%2Cproject_id%2Ctitle%2Cstatus%2Cversion'))
 assert.ok(f.calls[0].url.includes('project_id=eq.friday-ai-os'))
 assert.ok(f.calls[1].url.includes('id=eq.w1'))
 assert.ok(f.calls[2].url.includes('select=id%2Cscope%2Cowner_id%2Cproject_id%2Ccontent%2Cprovenance'))
 assert.ok(f.calls[2].url.includes('scope=eq.project'))
})
test('invalid or unpinned configured backend is never queried',async()=>{
 for(const url of ['http://supabase.mytechtactics.com',
  'https://evil.example','https://supabase.mytechtactics.com@evil.example',
  'https://supabase.mytechtactics.com/other','https://supabase.mytechtactics.com/?x=1',
  'file:///tmp/key']){
  const r=createSupabaseWorkReadRepository({...config,baseUrl:url,
   fetchImpl:async()=>{throw Error('external fetch should not run')}})
  await assert.rejects(r.list({projectId:'friday-ai-os',limit:2}),/work-read-storage-denied/)
 }
 const noKey=createSupabaseWorkReadRepository({baseUrl:target})
 await assert.rejects(noKey.list({projectId:'friday-ai-os',limit:2}),/work-read-storage-denied/)
})
test('only exact project and task identifiers with strict limits can be queried',async()=>{
 const f=fixture(()=>[])
 const values=[{projectId:'*',limit:1},{projectId:'friday-ai-os',limit:100},
  {projectId:'friday-ai-os',limit:0},{projectId:' ../etc',limit:1},
  {projectId:'friday-ai-os',limit:2,sql:'delete'}]
 for(const value of values)
  await assert.rejects(f.repo.list(value),/work-read-storage-denied/)
 for(const id of ['','w/1','*','w1;DROP TABLE','../../w1'])
  await assert.rejects(f.repo.get(id),/work-read-storage-denied/)
 for(const scope of [{scope:'global',ownerId:'all'},{scope:'project',ownerId:'*'}])
  await assert.rejects(f.repo.memorySearch({...scope,projectId:'friday-ai-os',limit:10}),
   /work-read-storage-denied/)
 assert.equal(f.calls.length,0)
})
test('read repository contains no write or RPC mutation methods',()=>{
 const r=createSupabaseWorkReadRepository(config)
 const methods=Object.keys(r).sort()
 assert.deepEqual(methods,['get','list','memorySearch'])
 for(const field of ['create','claim','checkpoint','handoff','release',
  'memoryPut','reviewDecision','insertProjects','rpc'])assert.equal(r[field],undefined)
})
test('malformed, oversized, unsafe and unexpected backend data is never accepted',async()=>{
 for(const value of [
  {},null,'string',[{...task,objective:'should-not-send'}],
  [{...task,project_id:'other'}],[{...task,title:'Bearer token12345678'}],
  new Array(60).fill(task),
 ]){
  const f=fixture(()=>value)
  await assert.rejects(f.repo.list({projectId:'friday-ai-os',limit:5}),
   /work-read-storage-denied/)
 }
 for(const status of [301,401,403,500]){
  const r=createSupabaseWorkReadRepository({...config,fetchImpl:async()=>new Response('PRIVATE KEY',
    {status})})
  await assert.rejects(r.get('w1'),e=>e.message==='work-read-storage-denied')
 }
})
