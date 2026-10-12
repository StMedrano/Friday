import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createDockerReadOnlyProxyServer, allowedDockerRead } from './docker-proxy.mjs'

test('proxy allows only sanitized inventory and inspect GET endpoints', () => {
  for(const path of [
    '/containers/json?all=1',
    '/containers/'+'a'.repeat(64)+'/json',
  ]) assert.equal(allowedDockerRead('GET',path),true,path)
  for(const path of [
    '/containers/json?all=0','/containers/json','/info','/_ping','/version',
    '/containers/'+'a'.repeat(64)+'/start',
    '/containers/'+'a'.repeat(64)+'/json?size=1',
    '/containers/'+'a'.repeat(64)+'/logs?stdout=1&stderr=1&timestamps=1&tail=100',
    '/containers/'+'a'.repeat(64)+'/logs?tail=9999',
    '/containers/'+'a'.repeat(64)+'/logs?stdout=1&stderr=1&timestamps=1&tail=201',
    '/containers/'+'a'.repeat(64)+'/logs?stderr=1&stdout=1&timestamps=1&tail=50',
    '/containers/'+encodeURIComponent('../..')+'/json',
    '/containers/'+'a'.repeat(64)+'/archive?path=/',
    '/images/json','/volumes','/events','/containers/create',
  ]) assert.equal(allowedDockerRead('GET',path),false,path)
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) {
    assert.equal(allowedDockerRead(method,'/containers/json?all=1'),false,method)
  }
})

test('proxy never forwards blocked requests to Docker upstream',async()=>{
 let upstreamCalls=0
 const upstream=http.createServer((_req,res)=>{upstreamCalls++;res.writeHead(200,{'content-type':'application/json'});res.end('[]')})
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve))
 const address=upstream.address()
 const proxy=createDockerReadOnlyProxyServer({
  dockerRequestOptions:()=>({hostname:'127.0.0.1',port:address.port}),
 })
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
 try {
  for(const [method,path] of [
   ['POST','/containers/json?all=1'],['GET','/containers/create'],
   ['GET','/containers/'+'a'.repeat(64)+'/exec'],
   ['GET','/containers/'+'a'.repeat(64)+'/logs?tail=9999'],
  ]) {
   const response=await fetch('http://127.0.0.1:'+proxy.address().port+path,{method})
   assert.equal(response.status,403,method+' '+path)
  }
  assert.equal(upstreamCalls,0)
  const permitted=await fetch('http://127.0.0.1:'+proxy.address().port+'/containers/json?all=1')
  assert.equal(permitted.status,200)
  assert.equal(await permitted.text(),'[]')
  assert.equal(upstreamCalls,1)
 }finally{
  await new Promise(resolve=>proxy.close(resolve))
  await new Promise(resolve=>upstream.close(resolve))
 }
})

test('proxy strips environment, mounts, paths and unknown labels before observer receives inspection data',async()=>{
 const secret='DO-NOT-EXPOSE-SYNTHETIC-SECRET'
 const id='a'.repeat(64)
 const upstream=http.createServer((req,res)=>{
  res.setHeader('content-type','application/json')
  if(req.url==='/containers/json?all=1'){
   res.end(JSON.stringify([{Id:id,Names:['/test'],Image:'test:1',State:'running',Status:'Up',Ports:[],Labels:{
    'com.docker.compose.project':'fixture','com.docker.compose.service':'worker',
    'customer.secret.label':secret
   },Config:{Env:['PASSWORD='+secret]},Mounts:[{Source:'/private/'+secret}]}]))
  }else{
   res.end(JSON.stringify({Id:id,Name:'/test',Image:'sha256:abc',
    Config:{Image:'test:1',Env:['API_TOKEN='+secret],Cmd:[secret],Labels:{
     'com.docker.compose.project':'fixture','com.docker.compose.service':'worker','private.key':secret
    }},
    State:{Status:'running',ExitCode:0,OOMKilled:false,Health:{Status:'healthy',Log:[{Start:'before',End:'after',ExitCode:0,Output:secret}]}},
    HostConfig:{RestartPolicy:{Name:'always',MaximumRetryCount:0},Binds:['/secrets:'+secret]},
    NetworkSettings:{Ports:{'3010/tcp':[{HostIp:'127.0.0.1',HostPort:'3010'}]},Networks:{fixture:{IPAMConfig:{Private:secret}}}},
    Mounts:[{Source:'/home/'+secret}],
   }))
  }
 })
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve))
 const proxy=createDockerReadOnlyProxyServer({dockerRequestOptions:()=>({hostname:'127.0.0.1',port:upstream.address().port})})
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
 try{
  for(const path of ['/containers/json?all=1', '/containers/'+id+'/json']){
   const res=await fetch('http://127.0.0.1:'+proxy.address().port+path)
   assert.equal(res.status,200)
   const body=await res.text()
   assert.doesNotMatch(body,/DO-NOT-EXPOSE-SYNTHETIC-SECRET|PASSWORD|API_TOKEN|customer\.secret|private\.key|\/secrets|\/home/)
   const json=JSON.parse(body)
   if(path.endsWith('/json?all=1')){
    assert.equal(json[0].Labels['com.docker.compose.project'],'fixture')
    assert.equal(json[0].Config,undefined)
   }else{
    assert.equal(json.Config.Image,'test:1')
    assert.equal(json.Config.Env,undefined)
    assert.equal(json.State.Health.Status,'healthy')
    assert.equal(json.State.Health.Log[0].Output,undefined)
    assert.equal(json.HostConfig.Binds,undefined)
   }
  }
 }finally{
  await new Promise(resolve=>proxy.close(resolve))
  await new Promise(resolve=>upstream.close(resolve))
 }
})

test('proxy denies raw container logs by default before contacting the Docker daemon',async()=>{
 let calls=0
 const upstream=http.createServer((_req,res)=>{calls++;res.end('DO-NOT-EXPOSE-SYNTHETIC-SECRET')})
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve))
 const proxy=createDockerReadOnlyProxyServer({dockerRequestOptions:()=>({hostname:'127.0.0.1',port:upstream.address().port})})
 await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
 try{
  const result=await fetch('http://127.0.0.1:'+proxy.address().port+'/containers/'+'a'.repeat(64)+'/logs?stdout=1&stderr=1&timestamps=1&tail=100')
  assert.equal(result.status,403)
  assert.equal(calls,0)
 }finally{
  await new Promise(resolve=>proxy.close(resolve))
  await new Promise(resolve=>upstream.close(resolve))
 }
})
