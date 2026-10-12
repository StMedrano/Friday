import test from 'node:test'
import assert from 'node:assert/strict'
import {createFridayServer} from '../http.mjs'

const baseConfig={
 mode:'live',port:3010,ai:{enabled:false},monitoring:{enabled:false},diagnostics:{enabled:true},
 access:{enabled:true,issuer:'https://test.cloudflareaccess.com',audience:'test-friday-application',operatorEmails:['operator@example.test'],publicOrigin:'https://friday.mytechtactics.com'},
 operator:{registrySyncToken:'a'.repeat(64)}
}
async function fixture(verifier, fn){
 let calls=0
 const spies={
  agentRegistryService:{list:async()=>{calls++;return []},get:async()=>null,status:async()=>({status:'ok'}),sync:async()=>{calls++;return {status:'ok'}}},
  monitoringRuntime:{rerunDiagnostic:async()=>{calls++;return {statusCode:200,body:{ok:true}}},getIncidents:()=>({summary:{},incidents:[]})},
  answerAssistantImpl:async()=>{calls++;return {available:true,text:'test'}}
 }
 const server=createFridayServer({config:baseConfig,verifyAccessImpl:verifier,...spies,buildOverviewImpl:async()=>{calls++;return {services:[]}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{await fn('http://127.0.0.1:'+server.address().port,()=>calls)}
 finally{await new Promise(r=>server.close(r))}
}
test('when Access is enabled, anonymous API requests are rejected before any data fetch or provider usage',async()=>{
 await fixture(async()=>({ok:false,status:401,error:'access-identity-required'}),async(base,count)=>{
  const paths=[['GET','/api/overview'],['GET','/api/incidents'],['GET','/api/agents'],['GET','/api/monitoring/history'],['POST','/api/assistant'],['POST','/api/agents/registry/sync'],['POST','/api/incidents/i1/diagnostics/rerun']]
  for(const [method,path] of paths){
   const res=await fetch(base+path,{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})})
   assert.equal(res.status,401,path)
  }
  assert.equal(count(),0)
  assert.equal((await fetch(base+'/healthz')).status,200)
  assert.equal((await fetch(base+'/api/health')).status,200)
 })
})
test('verified user can read data but cannot initiate operator-only diagnostics or sync',async()=>{
 await fixture(async()=>({ok:true,email:'reader@example.test',operator:false}),async(base,count)=>{
  const read=await fetch(base+'/api/overview')
  assert.equal(read.status,200)
  assert.equal(count(),1)
  const rerun=await fetch(base+'/api/incidents/i1/diagnostics/rerun',{method:'POST',headers:{'content-type':'application/json',origin:'https://friday.mytechtactics.com'},body:'{}'})
  assert.equal(rerun.status,403)
  const sync=await fetch(base+'/api/agents/registry/sync',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64),'content-type':'application/json',origin:'https://friday.mytechtactics.com'},body:'{}'})
  assert.equal(sync.status,403)
  assert.equal(count(),1)
 })
})
test('even authorized identities cannot send cross-origin mutating API requests',async()=>{
 await fixture(async()=>({ok:true,email:'operator@example.test',operator:true}),async(base,count)=>{
  const res=await fetch(base+'/api/incidents/i1/diagnostics/rerun',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'})
  assert.equal(res.status,403)
  assert.equal(count(),0)
 })
})
test('enabled Access with unset issuer/audience denies all protected APIs',async()=>{
 await fixture(async()=>({ok:false,status:503,error:'access-unconfigured'}),async(base,count)=>{
  assert.equal((await fetch(base+'/api/overview')).status,503)
  assert.equal(count(),0)
 })
})
test('authenticated AI requests are bounded per identity without invoking further providers',async()=>{
 await fixture(async()=>({ok:true,email:'operator@example.test',operator:true}),async(base,count)=>{
  for(let i=0;i<20;i++){
   const x=await fetch(base+'/api/assistant',{method:'POST',headers:{'content-type':'application/json',origin:'https://friday.mytechtactics.com'},body:JSON.stringify({prompt:'status'})})
   assert.equal(x.status,200,'request '+i)
  }
  const denied=await fetch(base+'/api/assistant',{method:'POST',headers:{'content-type':'application/json',origin:'https://friday.mytechtactics.com'},body:JSON.stringify({prompt:'status'})})
  assert.equal(denied.status,429)
  assert.equal(count(),40,'twenty allowed requests each called overview and assistant; denied request called neither')
 })
})
