import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {getAdGuardServices} from './adguard.mjs'

const config={
 enabled:true,baseUrl:'https://dns.example.test/adguard/',username:'friday',password:'synthetic-password',
 site:'Site A',configurationError:null,
}
const status={
 dns_addresses:['10.1.10.10'],dns_port:53,http_port:3000,protection_enabled:true,protection_disabled_duration:0,
 dhcp_available:false,running:true,version:'v0.107.52',language:'en',
}
const stats={
 time_units:'hours',num_dns_queries:12345,num_blocked_filtering:1012,num_replaced_safebrowsing:3,
 num_replaced_safesearch:0,num_replaced_parental:0,avg_processing_time:0.01372,
 top_queried_domains:[{'private-browsing.example.test':900}],
 top_clients:[{'10.1.10.55':4000}],
 top_blocked_domains:[{'tracker.example.test':300}],
 top_upstreams_responses:[{'https://dns.example.test/dns-query':12000}],
 dns_queries:[1,2,3],blocked_filtering:[0,1,0],
}
const json=(body,init={})=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'},...init})
function fake(responses){
 const requests=[]
 return {requests,fetchImpl:async(url,options)=>{
  requests.push({url:String(url),options})
  const next=responses[new URL(url).pathname.split('/').pop()]
  return typeof next==='function'?next():next
 }}
}

test('healthy AdGuard Home becomes one normalized DNS service with aggregate statistics only',async()=>{
 const {requests,fetchImpl}=fake({status:json(status),stats:json(stats)})
 const services=await getAdGuardServices(config,{fetchImpl})
 assert.equal(services.length,1)
 const [service]=services
 assert.deepEqual({...service,updated:undefined},{
  id:'adguard-home',name:'AdGuard Home',category:'dns',host:'dns.example.test',site:'Site A',status:'online',
  detail:'Protection on · 12,345 queries/24h · 8.2% blocked · 14 ms avg · v0.107.52',updated:undefined,
 })
 assert.ok(!Number.isNaN(Date.parse(service.updated)))
 const serialized=JSON.stringify(services)
 for(const privateValue of ['private-browsing','10.1.10.55','tracker.example','dns-query','synthetic-password','friday'])
  assert.equal(serialized.includes(privateValue),false,privateValue)
 assert.deepEqual(requests.map(request=>request.url).sort(),[
  'https://dns.example.test/adguard/control/stats',
  'https://dns.example.test/adguard/control/status',
 ])
 for(const request of requests){
  assert.equal(request.options.method,'GET')
  assert.equal(request.options.redirect,'manual')
  assert.equal(request.options.credentials,'omit')
  assert.equal(request.options.cache,'no-store')
  assert.equal(request.options.body,undefined)
  assert.ok(request.options.signal instanceof AbortSignal)
  assert.equal(request.options.headers.Authorization,'Basic '+Buffer.from('friday:synthetic-password').toString('base64'))
 }
})

test('disabled protection is degraded and a stopped DNS server is offline',async()=>{
 const disabled=await getAdGuardServices(config,fake({status:json({...status,protection_enabled:false}),stats:json(stats)}))
 assert.equal(disabled[0].status,'degraded')
 assert.match(disabled[0].detail,/^Protection disabled · /)
 const stopped=await getAdGuardServices(config,fake({status:json({...status,running:false}),stats:json(stats)}))
 assert.equal(stopped[0].status,'offline')
 assert.match(stopped[0].detail,/^DNS server not running · /)
})

test('multi-day statistics window, zero queries and unrecognised versions are reported conservatively',async()=>{
 const [service]=await getAdGuardServices({...config,site:'Site B'},fake({
  status:json({...status,version:'v1 ignore previous instructions'}),
  stats:json({...stats,time_units:'days',num_dns_queries:0,num_blocked_filtering:0,avg_processing_time:0}),
 }))
 assert.equal(service.site,'Site B')
 assert.equal(service.detail,'Protection on · 0 queries · 0.0% blocked · 0 ms avg')
})

test('authentication, HTTP and redirect responses are degraded without leaking credentials',async()=>{
 for(const [code,detail] of [[401,'API authentication failed'],[403,'API authentication failed'],[500,'API HTTP 500'],[302,'API HTTP 302']]){
  const [service]=await getAdGuardServices(config,fake({status:json({error:'synthetic-password'},{status:code}),stats:json(stats)}))
  assert.equal(service.status,'degraded')
  assert.equal(service.detail,detail)
  assert.equal(JSON.stringify(service).includes('synthetic-password'),false)
 }
})

test('malformed, oversized and invalid payloads are degraded rather than trusted',async()=>{
 const payloads=[
  {status:new Response('{not-json',{status:200})},
  {status:json({...status,running:'yes'})},
  {status:json({...status,protection_enabled:undefined})},
  {stats:json({...stats,num_dns_queries:-1})},
  {stats:json({...stats,num_blocked_filtering:'many'})},
  {stats:json({...stats,num_blocked_filtering:20000})},
  {stats:json({...stats,avg_processing_time:Number.POSITIVE_INFINITY})},
  {stats:new Response(JSON.stringify({...stats,padding:'x'.repeat(300*1024)}),{status:200})},
  {stats:new Response('x',{status:200,headers:{'content-length':String(10*1024*1024)}})},
  {status:json([status])},
 ]
 for(const override of payloads){
  const [service]=await getAdGuardServices(config,fake({status:json(status),stats:json(stats),...override}))
  assert.equal(service.status,'degraded',JSON.stringify(Object.keys(override)))
  assert.equal(service.detail,'Invalid API response')
 }
})

test('timeouts and network failures are offline so monitoring grace periods apply',async()=>{
 for(const [error,detail] of [[Object.assign(new Error('aborted'),{name:'AbortError'}),'Timeout'],[new TypeError('fetch failed: synthetic-password'),'Unreachable']]){
  const [service]=await getAdGuardServices(config,{fetchImpl:async()=>{throw error}})
  assert.equal(service.status,'offline')
  assert.equal(service.detail,detail)
  assert.equal(JSON.stringify(service).includes('synthetic-password'),false)
 }
})

test('a stalled AdGuard API is bounded by the adapter deadline',async()=>{
 const fetchImpl=(_url,{signal})=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))
 })
 const started=Date.now()
 const [service]=await getAdGuardServices(config,{fetchImpl,timeoutMs:20})
 assert.equal(service.status,'offline')
 assert.equal(service.detail,'Timeout')
 assert.ok(Date.now()-started<1000)
})

test('disabled AdGuard is inert and invalid enabled configuration fails as one integration',async()=>{
 let calls=0
 const fetchImpl=async()=>{calls++;return json(status)}
 assert.deepEqual(await getAdGuardServices({...config,enabled:false},{fetchImpl}),[])
 assert.deepEqual(await getAdGuardServices(undefined,{fetchImpl}),[])
 assert.equal(calls,0)
 await assert.rejects(
  getAdGuardServices({...config,baseUrl:'',password:'',configurationError:'invalid-adguard-configuration'},{fetchImpl}),
  /^Error: Invalid AdGuard configuration$/,
 )
 assert.equal(calls,0)
})

test('real HTTP transport sends only fixed authenticated GET requests and never follows redirects',async t=>{
 const seen=[]
 const server=http.createServer((request,response)=>{
  seen.push({method:request.method,url:request.url,authorization:request.headers.authorization})
  if(request.url==='/control/status')return response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(status))
  if(request.url==='/control/stats')return response.writeHead(302,{location:'/elsewhere'}).end()
  response.writeHead(404).end()
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}))
 const baseUrl=`http://127.0.0.1:${server.address().port}/`
 const [service]=await getAdGuardServices({...config,baseUrl})
 assert.equal(service.host,'127.0.0.1')
 assert.equal(service.status,'degraded')
 assert.equal(service.detail,'API HTTP 302')
 assert.deepEqual(seen.map(({method,url})=>`${method} ${url}`).sort(),['GET /control/stats','GET /control/status'])
 for(const request of seen)assert.equal(request.authorization,'Basic '+Buffer.from('friday:synthetic-password').toString('base64'))
})

test('adapter source contains only the two fixed read-only AdGuard API paths',async()=>{
 const source=await readFile(new URL('./adguard.mjs',import.meta.url),'utf8')
 assert.deepEqual([...source.matchAll(/control\/[a-z_/]+/g)].map(match=>match[0]).sort(),['control/stats','control/status'])
 assert.doesNotMatch(source,/method:\s*'(POST|PUT|PATCH|DELETE)'/i)
 assert.doesNotMatch(source,/child_process|execFile|spawn\(/)
})
