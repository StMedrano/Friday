import test from 'node:test'
import assert from 'node:assert/strict'
import {getEndpointServices} from './endpoints.mjs'

const checks=[
 {id:'site-a-friday',name:'Friday',site:'Site A',url:'https://friday.example.test/healthz',expectedStatuses:[200]},
 {id:'site-b-edge',name:'Remote edge',site:'Site B',url:'https://remote.example.test/status',expectedStatuses:[204,302]},
]

test('structured endpoint checks preserve stable identity, site, latency, and safe request options',async()=>{
 const requests=[]
 const ticks=[1000,2000,1037,2074]
 const fetchImpl=async(url,options)=>{
  requests.push({url,options})
  return {status:url.includes('remote')?302:200}
 }
 const services=await getEndpointServices({enabled:true,checks},{fetchImpl,now:()=>ticks.shift()})
 assert.deepEqual(services.map(({id,name,site,host,status,latencyMs})=>({id,name,site,host,status,latencyMs})),[
  {id:'endpoint-site-a-friday',name:'Friday',site:'Site A',host:'friday.example.test',status:'online',latencyMs:37},
  {id:'endpoint-site-b-edge',name:'Remote edge',site:'Site B',host:'remote.example.test',status:'online',latencyMs:74},
 ])
 for(const request of requests){
  assert.equal(request.options.method,'GET')
  assert.equal(request.options.redirect,'manual')
  assert.equal(request.options.credentials,'omit')
  assert.equal(request.options.cache,'no-store')
  assert.ok(request.options.signal instanceof AbortSignal)
 }
})

test('unexpected HTTP status is degraded and network or timeout failure is offline',async()=>{
 const status=await getEndpointServices({enabled:true,checks:[checks[0]]},{fetchImpl:async()=>({status:503}),now:()=>0})
 assert.equal(status[0].status,'degraded')
 assert.equal(status[0].detail,'HTTP 503 · 0 ms')

 for(const error of [Object.assign(new Error('timeout'),{name:'AbortError'}),new Error('network')]){
  const result=await getEndpointServices({enabled:true,checks:[checks[0]]},{fetchImpl:async()=>{throw error},now:()=>0})
  assert.equal(result[0].status,'offline')
  assert.equal(result[0].detail,error.name==='AbortError'?'Timeout':'Unreachable')
 }
})

test('disabled checks are inert and malformed enabled configuration fails as one integration',async()=>{
 let calls=0
 assert.deepEqual(await getEndpointServices({enabled:false,checks}, {fetchImpl:async()=>{calls++;return {status:200}}}),[])
 assert.equal(calls,0)
 await assert.rejects(
  getEndpointServices({enabled:true,checks:[],configurationError:'invalid-endpoint-configuration'}),
  /invalid endpoint configuration/i,
 )
})

test('legacy URL list remains supported as Site A checks',async()=>{
 const services=await getEndpointServices({enabled:true,urls:['https://legacy.example.test/health']},{fetchImpl:async()=>({status:204}),now:()=>0})
 assert.equal(services[0].id,'endpoint-legacy-0')
 assert.equal(services[0].site,'Site A')
 assert.equal(services[0].status,'online')
})
