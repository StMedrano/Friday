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

test('malformed request URLs return 400 without terminating the server before authentication',async()=>{
 const {spawnSync}=await import('node:child_process')
 const serverModule=new URL('../http.mjs',import.meta.url).href
 const script=`
  import {createConnection} from 'node:net'
  import {createFridayServer} from ${JSON.stringify(serverModule)}
  const server=createFridayServer({config:{mode:'live',ai:{enabled:false},access:{enabled:true}}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const port=server.address().port
  try {
   for(const raw of ['GET /api/overview HTTP/1.1\\r\\nHost: [\\r\\nConnection: close\\r\\n\\r\\n',
     'GET http://[ HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n']){
    const reply=await new Promise((resolve,reject)=>{
     const socket=createConnection({host:'127.0.0.1',port},()=>socket.write(raw))
     let response=''
     socket.on('data',chunk=>response+=chunk)
     socket.on('end',()=>resolve(response))
     socket.on('error',reject)
    })
    if(!reply.startsWith('HTTP/1.1 400 '))throw Error('malformed request was not rejected')
   }
   if((await fetch('http://127.0.0.1:'+port+'/healthz')).status!==200)throw Error('server did not survive')
  } finally {await new Promise(resolve=>server.close(resolve))}
 `
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:10_000})
 assert.equal(result.status,0,result.stderr||String(result.error))
})
