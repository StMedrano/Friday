import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateKeyPairSync, sign } from 'node:crypto'
import { createAutomationServer } from './automation.mjs'
import { createAccessGate } from './security/access.mjs'
import { getConfig } from './config.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const access={identityMode:'service',teamDomain:'https://team.cloudflareaccess.com',audience:'automation-aud',serviceTokenIds:['reader.access'],operatorEmails:[]}
const config={mode:'live',monitoring:{enabled:true},automation:{enabled:true,access}}
const overview={mode:'live',generatedAt:'2026-10-25T00:00:00Z',services:[{id:'vm-102',status:'online'}]}
function headers(claims={}) {
 const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
 const raw=b64({alg:'RS256',kid:'test'})+'.'+b64({iss:access.teamDomain,aud:[access.audience],type:'app',sub:'',common_name:'reader.access',exp:Math.floor(Date.now()/1000)+60,...claims})
 return {'cf-access-jwt-assertion':raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')}
}
async function withServer(t, overrides={}) {
 const logs=[]; let reads=0
 const server=createAutomationServer({config,monitoringRuntime:{
  getOverview:()=>{reads++;return overview},getSummary:()=>({status:'ok'}),
  getIncidents:()=>({incidents:[]}),getHistory:()=>({events:[]}),
 },accessGateImpl:createAccessGate(access,{fetchImpl:async()=>({ok:true,json:async()=>({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]})})}),
 logImpl:entry=>logs.push(entry),...overrides})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}))
 return {base:`http://127.0.0.1:${server.address().port}`,logs,reads:()=>reads}
}
test('automation defaults disabled with independent empty identity settings',()=>{
 assert.deepEqual(getConfig({}).automation,{enabled:false,port:3011,access:{identityMode:'service',teamDomain:'',audience:'',serviceTokenIds:[],operatorEmails:[]}})
 const c=getConfig({FRIDAY_AUTOMATION_ENABLED:'true',FRIDAY_AUTOMATION_PORT:'3012',FRIDAY_AUTOMATION_ACCESS_TEAM_DOMAIN:access.teamDomain,FRIDAY_AUTOMATION_ACCESS_AUD:access.audience,FRIDAY_AUTOMATION_SERVICE_TOKEN_IDS:'reader.access, next.access'})
 assert.equal(c.automation.enabled,true);assert.equal(c.automation.port,3012)
 assert.deepEqual(c.automation.access.serviceTokenIds,['reader.access','next.access'])
})
test('all automation routes, including health, require a signed allowed service identity',async t=>{
 const {base,reads}=await withServer(t)
 for(const path of ['/api/health','/api/overview','/api/incidents','/api/monitoring/history']) {
  assert.equal((await fetch(base+path)).status,403)
  assert.equal((await fetch(base+path,{headers:headers({common_name:'other.access'})})).status,403)
  assert.equal((await fetch(base+path,{headers:headers()})).status,200)
 }
 assert.deepEqual(await (await fetch(base+'/api/overview',{headers:headers()})).json(),overview)
 assert.equal(reads(),2)
})
test('automation denies writes, unknown routes, queries and encoded aliases before data access',async t=>{
 const {base,reads}=await withServer(t)
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD'])
  assert.equal((await fetch(base+'/api/overview',{method,headers:headers()})).status,405)
 for(const path of ['/','/healthz','/api/repositories','/api/assistant','/api/incidents/i/logs','/api/overview?url=http://internal','/api/%6fverview','/api/../api/agents'])
  assert.equal((await fetch(base+path,{headers:headers()})).status,404)
 assert.equal(reads(),0)
})
test('disabled, missing configuration, disabled monitoring and missing snapshots fail closed',async t=>{
 for(const overrides of [
  {config:{...config,automation:{enabled:false}}},
  {config:{...config,automation:{enabled:true,access:{}}},accessGateImpl:null},
  {config:{...config,monitoring:{enabled:false}}},
  {monitoringRuntime:{getOverview:()=>null}},
 ]) {
  const {base}=await withServer(t,overrides)
  assert.equal((await fetch(base+'/api/overview',{headers:headers()})).status,503)
 }
})
test('errors and audit records exclude credentials, raw paths, bodies and upstream errors',async t=>{
 const {base,logs}=await withServer(t,{monitoringRuntime:{getOverview:()=>{throw Error('private-secret')}}})
 const response=await fetch(base+'/api/overview',{headers:headers()})
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-secret/)
 await fetch(base+'/private-secret?token=private-secret',{headers:headers()})
 await fetch(base+'/api/overview',{headers:{'cf-access-jwt-assertion':'private-secret'}})
 assert.equal(logs.length,3)
 assert.deepEqual(logs.map(x=>x.status),[503,404,403])
 assert.doesNotMatch(JSON.stringify(logs),/private-secret|cf-access|reader\.access/)
 assert.ok(logs.every(x=>x.requestId&&x.event==='automation-request'))
})
test('oversized snapshots are rejected and security headers prevent caching',async t=>{
 const {base}=await withServer(t,{monitoringRuntime:{getOverview:()=>({data:'x'.repeat(2*1024*1024)})}})
 const r=await fetch(base+'/api/overview',{headers:headers()})
 assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store')
})
