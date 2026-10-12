import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createFridayServer} from './http.mjs'
import {getConfig} from './config.mjs'
async function request(options,fn){
 const server=createFridayServer(options)
 server.listen(0,'127.0.0.1')
 await once(server,'listening')
 try{return await fn('http://127.0.0.1:'+server.address().port)}
 finally{server.close();await once(server,'close')}
}
test('real live configuration requires signed identity, otherwise never calls data services',async()=>{
 const config=getConfig({FRIDAY_MODE:'live',FRIDAY_ACCESS_TEAM_DOMAIN:'',FRIDAY_ACCESS_AUD:''})
 let calls=0
 await request({config,buildOverviewImpl:async()=>{calls++;return {}}},async base=>{
  assert.equal((await fetch(base+'/healthz')).status,200)
  assert.equal((await fetch(base+'/api/health')).status,200)
  assert.equal((await fetch(base+'/api/overview')).status,503)
  assert.equal((await fetch(base+'/api/incidents')).status,503)
  assert.equal((await fetch(base+'/api/agents')).status,503)
  assert.equal((await fetch(base+'/api/assistant',{method:'POST',headers:{'content-type':'application/json'},body:'{"prompt":"hi"}'})).status,503)
  assert.equal((await fetch(base+'/api/agents/registry/sync',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,503)
  assert.equal(calls,0)
 })
})
test('verified identity is required for all APIs and operator identity for registry sync',async()=>{
 const config=getConfig({FRIDAY_MODE:'live'})
 let calls=0
 const agentRegistryService={
  sync:async()=>{calls++;return {ok:true}},
  list:async()=>[{id:'agent'}]
 }
 const accessGateImpl=async(_req,operator)=>operator?{status:403,error:'access-denied'}:{status:200,identity:{subject:'verified-user'}}
 await request({config,agentRegistryService,accessGateImpl},async base=>{
  assert.equal((await fetch(base+'/api/agents')).status,200)
  assert.equal((await fetch(base+'/api/agents/registry/sync',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403)
  assert.equal((await fetch(base+'/api/agents/route',{method:'POST',headers:{'sec-fetch-site':'cross-site','content-type':'application/json'},body:'{}'})).status,403)
  assert.equal(calls,0)
 })
})

test('verified operator cannot trigger registry sync with a simple cross-site form',async()=>{
 const config=getConfig({FRIDAY_MODE:'live'})
 let calls=0
 const accessGateImpl=async()=>({status:200,identity:{subject:'signed-operator'}})
 await request({config,accessGateImpl,agentRegistryService:{sync:async()=>{calls++;return {ok:true}}}},async base=>{
  const result=await fetch(base+'/api/agents/registry/sync',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'})
  assert.equal(result.status,415)
  assert.equal(calls,0)
 })
})
