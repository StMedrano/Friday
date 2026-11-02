import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createFridayServer} from './http.mjs'
import {getConfig} from './config.mjs'

const event={id:'e1',type:'incident-opened',at:'2026-10-15T00:00:00Z',source:'monitoring',detail:'Fixture observation'}
const baseConfig=getConfig({FRIDAY_MODE:'live'})
async function run({enabled=true,runtime=null,accessGateImpl}={},check){
 const server=createFridayServer({config:{...baseConfig,monitoring:{...baseConfig.monitoring,enabled}},monitoringRuntime:runtime,accessGateImpl:accessGateImpl||(async()=>({status:200,identity:{subject:'reader',email:'reader@example.test'}}))})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 try{await check('http://127.0.0.1:'+server.address().port)}finally{await new Promise(resolve=>server.close(resolve))}
}
test('missing runtime or missing reader is unavailable, never successful empty history',async()=>{
 for(const runtime of [null,{}])await run({runtime},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'monitoring-history-unavailable'})
 })
})
test('disabled monitoring is explicit and does not read the runtime',async()=>{
 let reads=0
 await run({enabled:false,runtime:{getHistory(){reads++;return {events:[event]}}}},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'monitoring-disabled'});assert.equal(reads,0)
 })
})
test('empty history and recorded events succeed only after a validated runtime read',async()=>{
 for(const events of [[],[event]])await run({runtime:{getHistory:async()=>({events})}},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{events})
 })
})
test('malformed history is invalid and cannot leak an unprojected record',async()=>{
 for(const body of [null,{}, {events:null},{events:'x'}])await run({runtime:{getHistory:()=>body}},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'monitoring-history-invalid'})
 })
 await run({runtime:{getHistory:()=>({events:[{...event,token:'PRIVATE'}],secret:'PRIVATE'})}},async base=>{
  const response=await fetch(base+'/api/monitoring/history');assert.deepEqual(await response.json(),{events:[event]})
 })
})
test('runtime read failure is sanitized and later reads can recover',async()=>{
 let calls=0
 await run({runtime:{getHistory:async()=>{if(++calls===1)throw Error('PRIVATE');return {events:[event]}}}},async base=>{
  const failed=await fetch(base+'/api/monitoring/history');assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'monitoring-history-unavailable'})
  assert.equal((await fetch(base+'/api/monitoring/history')).status,200)
 })
})
test('Access denial precedes all monitoring reads and writes remain unavailable',async()=>{
 let reads=0
 await run({accessGateImpl:async()=>({status:401}),runtime:{getHistory(){reads++;return {events:[]}}}},async base=>{
  assert.ok([401,403].includes((await fetch(base+'/api/monitoring/history')).status));assert.equal(reads,0)
 })
 await run({runtime:{getHistory(){reads++;return {events:[]}}}},async base=>{
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.ok([403,404].includes((await fetch(base+'/api/monitoring/history',{method})).status))
  assert.equal(reads,0)
 })
})
test('legacy events with null optional fields are kept without the null fields',async()=>{
 await run({runtime:{getHistory:()=>({events:[{...event,host:null,serviceId:'svc',serviceName:null}]})}},async base=>{
  assert.deepEqual(await (await fetch(base+'/api/monitoring/history')).json(),{events:[{...event,serviceId:'svc'}]})
 })
})
test('history longer than the client cap is served as the newest 5000 events, not an error',async()=>{
 const events=Array.from({length:5002},(_,i)=>({...event,id:'e'+i}))
 await run({runtime:{getHistory:()=>({events})}},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.events.length,5000);assert.equal(body.events[0].id,'e0');assert.equal(body.events.at(-1).id,'e4999')
 })
})
test('a malformed event is dropped and repeated IDs collapse to the first, without hiding the rest',async()=>{
 const other={...event,id:'e2',detail:'Second'}
 await run({runtime:{getHistory:()=>({events:[event,{...event,detail:'duplicate'},{...event,id:'bad',at:'not a date'},{...other,host:7},other]})}},async base=>{
  const response=await fetch(base+'/api/monitoring/history')
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{events:[event,other]})
 })
})
