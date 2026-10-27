import test from 'node:test'
import assert from 'node:assert/strict'
import {
 FOUR_PROJECT_CATALOG,createFourProjectCatalogBootstrap,
 verifyFourProjectCatalog,
} from './four-project-catalog.mjs'
import {createFourProjectEnrollment} from './four-project-enrollment.mjs'

const expected=[
 {id:'friday-ai-os',name:'Friday AI OS'},
 {id:'techtactics',name:'TechTactics'},
 {id:'web-growth-agents',name:'Web Growth Agents'},
 {id:'app-builder',name:'App Builder'},
]
const clone=value=>JSON.parse(JSON.stringify(value))
const subject='12345678-1234-4234-9234-123456789abc'
const t0=1793100000000

test('four owner-selected projects have stable distinct human-readable rows',()=>{
 assert.deepEqual(FOUR_PROJECT_CATALOG,expected)
 assert.equal(new Set(FOUR_PROJECT_CATALOG.map(p=>p.id)).size,4)
 assert.equal(Object.isFrozen(FOUR_PROJECT_CATALOG),true)
 assert.ok(FOUR_PROJECT_CATALOG.every(Object.isFrozen))
 assert.deepEqual(verifyFourProjectCatalog(expected),{
  'friday-ai-os':'friday-ai-os',
  techtactics:'techtactics',
  'web-growth-agents':'web-growth-agents',
  'app-builder':'app-builder',
 })
 const proposed=createFourProjectEnrollment({
  verifiedAccessSub:subject,
  verifiedProjectIds:verifyFourProjectCatalog(expected),
  now:t0,expiresAt:t0+600000,
 })
 assert.deepEqual(proposed.users[0].allowedProjectIds,expected.map(p=>p.id))
 assert.deepEqual(proposed.users[0].allowedMemoryScopes,expected.map(p=>({
  scope:'project',ownerId:p.id,
 })))
})

test('catalog verification refuses fabricated, conflicting, incomplete or mismatched records',()=>{
 for(const rows of [
  [],[...expected.slice(0,3)],
  [...expected,{id:'friday-ai-os',name:'Friday AI OS'}],
  [...expected.slice(0,3),{id:'app-builder',name:'Wrong owner'}],
  [...expected.slice(0,3),{id:'APP-BUILDER',name:'App Builder'}],
  [...expected.slice(0,3),{id:'other-project',name:'App Builder'}],
  [{id:'friday-ai-os',name:'Friday AI OS'},...expected],
  [...expected.slice(0,3),{id:'app-builder',name:'App Builder',role:'admin'}],
  null,{},'four projects',
 ])assert.throws(()=>verifyFourProjectCatalog(rows),/four-project-catalog-denied/)
 // Unrelated existing project IDs can remain; grants are still exact.
 assert.deepEqual(verifyFourProjectCatalog([...expected,{id:'other',name:'Other'}]),{
  'friday-ai-os':'friday-ai-os',techtactics:'techtactics',
  'web-growth-agents':'web-growth-agents','app-builder':'app-builder',
 })
})

function fixture(initial=[],enabled=false){
 let state=clone(initial)
 const events=[]
 const repo={
  async listProjects(){
   events.push('read')
   return clone(state)
  },
  async insertProjects(rows){
   events.push(['insert',clone(rows)])
   for(const row of rows){
    if(!state.some(r=>r.id===row.id))state.push(clone(row))
   }
  },
 }
 const boot=createFourProjectCatalogBootstrap({repo,enabled})
 return {boot,events,rows:()=>clone(state),replace:x=>{state=clone(x)}}
}

test('default disabled catalog bootstrap is read-only and denies every write',async()=>{
 const f=fixture([])
 assert.equal(f.boot.enabled,false)
 assert.deepEqual(await f.boot.inspect(),{
  status:'missing',existing:0,missing:expected,
 })
 await assert.rejects(f.boot.apply({approved:true}),/four-project-catalog-denied/)
 assert.deepEqual(f.events,['read'])
 assert.deepEqual(f.rows(),[])
 assert.equal(createFourProjectCatalogBootstrap().enabled,false)
})

test('enabled internal bootstrap requires exact owner approval and a matching freshness marker',async()=>{
 const f=fixture([],true)
 const plan=await f.boot.inspect()
 assert.equal(plan.status,'missing')
 assert.equal(typeof plan.fingerprint,'string')
 assert.match(plan.fingerprint,/^[a-f0-9]{64}$/)
 for(const input of [
  undefined,{}, {approved:true},{approved:true,fingerprint:'not-sha'},
  {approved:false,fingerprint:plan.fingerprint},
  {approved:true,fingerprint:plan.fingerprint,grantActions:true},
 ]){
  await assert.rejects(f.boot.apply(input),/four-project-catalog-denied/)
 }
 assert.equal(f.events.some(x=>Array.isArray(x)),false)
 await f.boot.apply({approved:true,fingerprint:plan.fingerprint,request:'bootstrap-four-project-catalog'})
 assert.deepEqual(f.rows(),expected)
 const writes=f.events.filter(Array.isArray)
 assert.deepEqual(writes,[['insert',expected]])
 const second=await f.boot.inspect()
 assert.equal(second.status,'ready')
 await f.boot.apply({approved:true,fingerprint:second.fingerprint,request:'bootstrap-four-project-catalog'})
 assert.equal(f.events.filter(Array.isArray).length,1)
})

test('conflicting records deny with no write and unrelated projects remain untouched',async()=>{
 const f=fixture([{id:'techtactics',name:'Wrong Name'}],true)
 await assert.rejects(f.boot.inspect(),/four-project-catalog-denied/)
 await assert.rejects(f.boot.apply({approved:true,fingerprint:'a'.repeat(64),
  request:'bootstrap-four-project-catalog'}),/four-project-catalog-denied/)
 assert.equal(f.events.some(Array.isArray),false)
 const g=fixture([{id:'unrelated',name:'Unrelated Project'},expected[0]],true)
 const plan=await g.boot.inspect()
 assert.deepEqual(plan.missing,expected.slice(1))
 await g.boot.apply({approved:true,fingerprint:plan.fingerprint,
  request:'bootstrap-four-project-catalog'})
 assert.deepEqual(g.rows(),[{id:'unrelated',name:'Unrelated Project'},...expected])
 assert.deepEqual(g.events.filter(Array.isArray),[['insert',expected.slice(1)]])
})

test('stale approval fingerprint and race-condition conflict fail closed before any insert',async()=>{
 const f=fixture([],true)
 const plan=await f.boot.inspect()
 f.replace([{id:'techtactics',name:'Different'}])
 await assert.rejects(f.boot.apply({approved:true,fingerprint:plan.fingerprint,
  request:'bootstrap-four-project-catalog'}),/four-project-catalog-denied/)
 assert.equal(f.events.some(Array.isArray),false)
 const g=fixture([],true)
 const first=await g.boot.inspect()
 g.replace([{id:'unrelated',name:'New row'}])
 await assert.rejects(g.boot.apply({approved:true,fingerprint:first.fingerprint,
  request:'bootstrap-four-project-catalog'}),/four-project-catalog-denied/)
 assert.equal(g.events.some(Array.isArray),false)
})

test('storage failure or dishonest post-write response is not called success',async()=>{
 let state=[]
 const boot=createFourProjectCatalogBootstrap({enabled:true,repo:{
  listProjects:async()=>clone(state),
  insertProjects:async()=>{},
 }})
 const plan=await boot.inspect()
 await assert.rejects(boot.apply({approved:true,fingerprint:plan.fingerprint,
  request:'bootstrap-four-project-catalog'}),/four-project-catalog-denied/)
 const failing=createFourProjectCatalogBootstrap({enabled:true,repo:{
  listProjects:async()=>{throw Error('PRIVATE DATABASE FAILURE')},
  insertProjects:async()=>{throw Error('NEVER')},
 }})
 await assert.rejects(failing.inspect(),err=>{
  assert.equal(err.message,'four-project-catalog-denied')
  return true
 })
})
