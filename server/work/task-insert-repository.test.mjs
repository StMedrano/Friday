import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseTaskInsertRepository} from './task-insert-repository.mjs'

const principal='access:'+'a'.repeat(64)
const fingerprint='b'.repeat(64)
const input={projectId:'friday-ai-os',title:'Write release notes',objective:'Write release notes',
 principalId:principal,requestId:'req-1',inputFingerprint:fingerprint}
const row={id:'0f8fad5b-d9cb-469f-a165-70867728950e',project_id:'friday-ai-os',title:'Write release notes',status:'ready',version:1}

function fake(responses){
 const calls=[]
 const fetchImpl=async(url,options)=>{
  calls.push({url,options})
  const next=responses.shift()
  if(next instanceof Error)throw next
  return new Response(JSON.stringify(next.body),{status:next.status??201})
 }
 return {calls,fetchImpl}
}
const repo=(fetchImpl,extra={})=>createSupabaseTaskInsertRepository({
 baseUrl:'https://supabase.mytechtactics.com',writeKey:'writer-jwt',gatewayKey:'gateway-anon',fetchImpl,...extra})

test('creates one ready task with fixed columns, the writer bearer and the gateway key',async()=>{
 const f=fake([{body:[row]}])
 const task=await repo(f.fetchImpl).create(input)
 assert.deepEqual(task,{id:row.id,projectId:'friday-ai-os',title:'Write release notes',status:'ready',version:1})
 assert.equal(f.calls.length,1)
 const {url,options}=f.calls[0]
 assert.equal(url,'https://supabase.mytechtactics.com/rest/v1/friday_work_items?on_conflict=creator_principal,request_id&select=id%2Cproject_id%2Ctitle%2Cstatus%2Cversion')
 assert.equal(options.method,'POST')
 assert.equal(options.redirect,'error')
 assert.equal(options.headers.authorization,'Bearer writer-jwt')
 assert.equal(options.headers.apikey,'gateway-anon')
 assert.equal(options.headers.prefer,'resolution=ignore-duplicates,return=representation')
 assert.deepEqual(JSON.parse(options.body),{project_id:'friday-ai-os',title:'Write release notes',
  objective:'Write release notes',acceptance_criteria:[],creator_principal:principal,
  request_id:'req-1',input_fingerprint:fingerprint})
})

test('a retried request returns the earlier task; different content is a conflict',async()=>{
 const same=fake([{body:[]},{status:200,body:[{...row,input_fingerprint:fingerprint}]}])
 assert.equal((await repo(same.fetchImpl).create(input)).id,row.id)
 assert.equal(same.calls[1].options.method,'GET')
 assert.match(same.calls[1].url,/creator_principal=eq\.access%3Aa+&request_id=eq\.req-1&select=/)
 const changed=fake([{body:[]},{status:200,body:[{...row,input_fingerprint:'c'.repeat(64)}]}])
 await assert.rejects(repo(changed.fetchImpl).create(input),e=>e.code==='conflict')
})

test('refuses bad input before any request and without a key or the fixed host',async()=>{
 const f=fake([])
 for(const bad of [{...input,principalId:'runtime'},{...input,title:' padded '},{...input,title:''},
  {...input,projectId:'../x'},{...input,inputFingerprint:'short'},{...input,extra:1}]){
  await assert.rejects(repo(f.fetchImpl).create(bad))
 }
 assert.equal(f.calls.length,0)
 assert.equal(repo(f.fetchImpl,{writeKey:''}).enabled,false)
 assert.equal(repo(f.fetchImpl,{baseUrl:'https://evil.example'}).enabled,false)
 await assert.rejects(repo(f.fetchImpl,{writeKey:''}).create(input))
 assert.equal(f.calls.length,0)
})

test('rejects storage errors and rows that are not a fresh ready task in the project',async()=>{
 for(const response of [{status:401,body:{message:'denied'}},{body:[{...row,status:'in_progress'}]},
  {body:[{...row,project_id:'other'}]},{body:[{...row,version:2}]},{body:[{...row,extra:true}]},
  {body:[row,row]},{body:{}}]){
  await assert.rejects(repo(fake([response]).fetchImpl).create(input),e=>e.code!=='conflict')
 }
 await assert.rejects(repo(fake([Error('network down')]).fetchImpl).create(input))
})
