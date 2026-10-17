import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseWorkRepository} from './supabase-repository.mjs'
test('RPC writes use server-only bearer and return typed results',async()=>{
 const calls=[]
 const repo=createSupabaseWorkRepository({baseUrl:'http://homelab-gateway:8000',serviceKey:'server-secret',fetchImpl:async(url,opts)=>{
  calls.push({url,opts})
  return new Response(JSON.stringify({status:'claimed',claimId:'c1',workVersion:2}),{status:200})
 }})
 const v=await repo.claim({workId:'w1',expectedVersion:1,principalId:'owner',agentId:'coder',runId:'run',leaseSeconds:120,requestId:'q1'})
 assert.equal(v.status,'claimed')
 assert.equal(calls[0].url,'http://homelab-gateway:8000/rest/v1/rpc/friday_claim_work')
 assert.equal(calls[0].opts.headers.authorization,'Bearer server-secret')
 assert.equal(calls[0].opts.headers.apikey,'server-secret')
 assert.equal(JSON.stringify(v).includes('server-secret'),false)
})
test('secret/error payloads are never returned to callers',async()=>{
 for (const status of [401,403,409,429,500]){
  const repo=createSupabaseWorkRepository({baseUrl:'http://homelab-gateway',serviceKey:'private-secret',fetchImpl:async()=>new Response('private-secret database error',{status})})
  await assert.rejects(repo.get('work-1'),e=>e.kind && !JSON.stringify(e).includes('private-secret'))
 }
})
test('invalid endpoint and missing server key fail closed',async()=>{
 for(const cfg of [{baseUrl:'file:///tmp/secret',serviceKey:'key'},{baseUrl:'http://localhost:8000',serviceKey:''}]){
  const repo=createSupabaseWorkRepository(cfg)
  await assert.rejects(repo.get('item'),e=>e.kind==='storage-unavailable')
 }
})
test('same-key work create retries return prior record instead of duplicate and changed payload conflicts',async()=>{
 const calls=[]
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts})
  if(opts.method==='POST')return new Response('[]',{status:201})
  return new Response(JSON.stringify([{id:'existing-1',project_id:'project-a',
    input_fingerprint:'hash-correct',title:'Task'}]),{status:200})
 }
 const repo=createSupabaseWorkRepository({baseUrl:'http://homelab',serviceKey:'private',fetchImpl})
 const input={projectId:'project-a',title:'Task',objective:'objective',acceptanceCriteria:[],
  principalId:'worker',requestId:'work-retry',inputFingerprint:'hash-correct'}
 assert.equal((await repo.create(input)).id,'existing-1')
 assert.ok(calls[0].opts.headers.prefer.includes('ignore-duplicates'))
 await assert.rejects(repo.create({...input,inputFingerprint:'changed'}),e=>e.kind==='idempotency-conflict')
})