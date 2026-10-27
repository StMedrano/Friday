import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseProjectCatalogRepository} from './supabase-project-catalog.mjs'
import {createFourProjectCatalogBootstrap,FOUR_PROJECT_CATALOG} from './four-project-catalog.mjs'

function fixture({allowInsert=false,initial=[],status=200,wrongRows}={}){
 let rows=initial.map(x=>({...x}))
 const calls=[]
 const fetchImpl=async(url,opts)=>{
  calls.push({url,method:opts.method,headers:opts.headers,body:opts.body,redirect:opts.redirect})
  if(status!==200)return {status,ok:false,text:async()=>JSON.stringify({message:'SENSITIVE BACKEND ERROR'})}
  if(opts.method==='GET')return {status:200,ok:true,text:async()=>JSON.stringify(wrongRows??rows)}
  if(opts.method==='POST'){
   const inserted=JSON.parse(opts.body)
   for(const v of inserted){
    if(rows.some(x=>x.id===v.id))return {status:409,ok:false,text:async()=>''}
   }
   rows=[...rows,...inserted]
   return {status:201,ok:true,text:async()=>JSON.stringify(inserted)}
  }
  throw Error('forbidden-method')
 }
 const repo=createSupabaseProjectCatalogRepository({
  baseUrl:'https://supabase.mytechtactics.com',serviceKey:'fixture-private-key',
  allowInsert,fetchImpl,
 })
 return {repo,calls,rows:()=>rows}
}

test('bounded exact remote GET is private, no redirects, never a browser request',async()=>{
 const f=fixture({initial:FOUR_PROJECT_CATALOG})
 assert.deepEqual(await f.repo.listProjects(),FOUR_PROJECT_CATALOG)
 assert.deepEqual(f.calls.map(x=>[x.method,x.url,x.redirect]),[
  ['GET','https://supabase.mytechtactics.com/rest/v1/friday_projects?select=id,name&limit=100','error'],
 ])
 assert.equal(f.calls[0].headers.apikey,'fixture-private-key')
 assert.equal(f.calls[0].headers.authorization,'Bearer fixture-private-key')
 assert.equal(f.calls[0].body,undefined)
})

test('project insert is disabled by default and does not call remote API',async()=>{
 const f=fixture()
 await assert.rejects(f.repo.insertProjects(FOUR_PROJECT_CATALOG),/four-project-catalog-denied/)
 assert.deepEqual(f.calls,[])
 const missing=createSupabaseProjectCatalogRepository()
 await assert.rejects(missing.listProjects(),/four-project-catalog-denied/)
 const wrong=createSupabaseProjectCatalogRepository({
  baseUrl:'http://example.com',serviceKey:'fixture',
  fetchImpl:async()=>{throw Error('unexpected-call')},
 })
 await assert.rejects(wrong.listProjects(),/four-project-catalog-denied/)
})

test('write-enabled staging adapter only accepts exact owner-selected missing rows',async()=>{
 const f=fixture({allowInsert:true})
 const p=f.repo.insertProjects(FOUR_PROJECT_CATALOG)
 await p
 assert.deepEqual(f.rows(),FOUR_PROJECT_CATALOG)
 const call=f.calls[0]
 assert.equal(call.method,'POST')
 assert.equal(call.url,'https://supabase.mytechtactics.com/rest/v1/friday_projects?select=id,name')
 assert.deepEqual(JSON.parse(call.body),FOUR_PROJECT_CATALOG)
 assert.equal(call.headers.prefer,'return=representation')
 for(const invalid of [
  [],null,[{id:'made-up',name:'Unknown'}],
  [{id:'techtactics',name:'Different'}],
  [{...FOUR_PROJECT_CATALOG[0],role:'Admin'}],
  [FOUR_PROJECT_CATALOG[0],FOUR_PROJECT_CATALOG[0]],
 ]){
  await assert.rejects(f.repo.insertProjects(invalid),/four-project-catalog-denied/)
 }
 assert.equal(f.calls.length,1)
})

test('realistic in-memory Supabase staging API works with explicit snapshot approval',async()=>{
 const f=fixture({allowInsert:true})
 const boot=createFourProjectCatalogBootstrap({enabled:true,repo:f.repo})
 const plan=await boot.inspect()
 assert.equal(plan.status,'missing')
 assert.equal(f.calls.every(c=>c.method==='GET'),true)
 await boot.apply({approved:true,fingerprint:plan.fingerprint,request:'bootstrap-four-project-catalog'})
 assert.deepEqual(f.rows(),FOUR_PROJECT_CATALOG)
 assert.deepEqual(f.calls.map(c=>c.method),['GET','GET','POST','GET'])
})

test('backend non-200, response shape, oversize and fetch errors deny without leaking details',async()=>{
 for(const status of [401,403,404,409,500]){
  const f=fixture({status})
  await assert.rejects(f.repo.listProjects(),err=>{
   assert.equal(err.message,'four-project-catalog-denied');return true
  })
 }
 const bad=fixture({wrongRows:{role:'admin'}})
 await assert.rejects(bad.repo.listProjects(),/four-project-catalog-denied/)
 const giant=fixture({wrongRows:'x'.repeat(50000)})
 await assert.rejects(giant.repo.listProjects(),/four-project-catalog-denied/)
 const throwing=createSupabaseProjectCatalogRepository({
  baseUrl:'https://supabase.mytechtactics.com',serviceKey:'fixture',
  fetchImpl:async()=>{throw Error('PRIVATE NETWORK CREDENTIAL')},
 })
 await assert.rejects(throwing.listProjects(),err=>{
  assert.equal(err.message,'four-project-catalog-denied');return true
 })
})
