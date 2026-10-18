import test from 'node:test'
import assert from 'node:assert/strict'
import {createSupabaseWorkRepository} from './supabase-repository.mjs'
import {createProjectTaskAccess} from './project-access.mjs'
test('provisioned project catalog uses bounded server-side PostgREST read and rejects malformed data',async()=>{
 let calls=[];let payload=[{id:'project-a',name:'Fixture'}]
 const repo=createSupabaseWorkRepository({baseUrl:'https://fixture.invalid',serviceKey:'synthetic-key',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>payload}}})
 assert.deepEqual(await repo.listProjects(),payload)
 assert.equal(calls[0].url,'https://fixture.invalid/rest/v1/friday_projects?select=id,name&order=id.asc&limit=51')
 assert.equal(calls[0].options.method,'GET')
 payload={};await assert.rejects(repo.listProjects(),e=>e.kind==='storage-unavailable')
})

test('malformed PostgREST tasks remain unavailable through adapter and access service',async()=>{
 const owner={email:'owner@example.test',principalId:'fixture-owner'}
 const repository=createSupabaseWorkRepository({baseUrl:'https://fixture.invalid',serviceKey:'synthetic-key',fetchImpl:async url=>({ok:true,json:async()=>url.includes('friday_projects')?[{id:'project-a',name:'Fixture'}]:{error:'PRIVATE malformed result'}})})
 const access=createProjectTaskAccess({repository,owner})
 await assert.rejects(access.list({ok:true,email:owner.email},'project-a'),e=>e.kind==='storage-unavailable')
})
