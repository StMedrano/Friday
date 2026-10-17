import test from 'node:test'
import assert from 'node:assert/strict'
import {createProjectTaskAccess} from './project-access.mjs'
import {createSupabaseWorkRepository} from './supabase-repository.mjs'
const identity={ok:true,email:'owner@example.test'},owner={email:identity.email,principalId:'fixture-owner'}
const rows=Array.from({length:51},(_,i)=>({id:'00000000-0000-4000-8000-'+String(100-i).padStart(12,'0'),createdAt:'2026-10-17T12:00:00.123456Z',projectId:'project-a',title:'Task '+i,objective:'Goal',acceptanceCriteria:[],version:1,status:'ready'}))
test('page access rechecks catalog and owner, returning 50 projected records and continuation',async()=>{
 let projects=[{id:'project-a',name:'Fixture'}],calls=[]
 const access=createProjectTaskAccess({owner,repository:{listProjects:async()=>projects,listPage:async input=>{calls.push(input);return input.after?rows.slice(50):rows}}})
 const first=await access.page(identity,'project-a')
 assert.equal(first.tasks.length,50);assert.ok(first.nextCursor);assert.equal(first.tasks[0].createdAt,undefined)
 const second=await access.page(identity,'project-a',first.nextCursor)
 assert.equal(second.tasks.length,1);assert.equal(second.nextCursor,null)
 await assert.rejects(access.page({ok:true,email:'other@example.test'},'project-a',first.nextCursor),e=>e.kind==='not-authorized')
 projects=[];await assert.rejects(access.page(identity,'project-a',first.nextCursor),e=>e.kind==='not-authorized')
 assert.equal(calls.length,2)
})
test('repository encodes only validated fixed filters and rejects malformed cursor before fetching',async()=>{
 let captured,calls=0
 const repo=createSupabaseWorkRepository({baseUrl:'https://fixture.invalid',serviceKey:'synthetic-key',fetchImpl:async(url,options)=>{calls++;captured={url,options};return {ok:true,json:async()=>[]}}})
 const after={id:rows[0].id,createdAt:rows[0].createdAt}
 await repo.listPage({projectId:'project-a',after})
 const url=new URL(captured.url)
 assert.equal(url.searchParams.get('project_id'),'eq.project-a');assert.equal(url.searchParams.get('limit'),'51');assert.equal(url.searchParams.get('order'),'created_at.desc,id.desc')
 assert.equal(url.searchParams.get('or'),`(created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id}))`)
 assert.equal(captured.options.method,'GET')
 await assert.rejects(repo.listPage({projectId:'project-a',after:{...after,id:'x),project_id.eq.private'}}))
 assert.equal(calls,1)
})
