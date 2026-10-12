import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createDockerReadOnlyProxyServer, allowedDockerRead } from './docker-proxy.mjs'

test('proxy allows only the three approved bounded Docker GET endpoints', () => {
  for(const path of [
    '/containers/json?all=1',
    '/containers/'+'a'.repeat(64)+'/json',
    '/containers/'+'b'.repeat(64)+'/logs?stdout=1&stderr=1&timestamps=1&tail=100',
  ]) assert.equal(allowedDockerRead('GET',path),true,path)
  for(const path of [
    '/containers/json?all=0','/containers/json','/info','/_ping','/version',
    '/containers/'+'a'.repeat(64)+'/start',
    '/containers/'+'a'.repeat(64)+'/json?size=1',
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
