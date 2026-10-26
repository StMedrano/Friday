import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudSettings, cloudRequest, checkConnection } from './check-cloud-connection.mjs'

const env={FRIDAY_CLOUD_URL:'https://friday-api.example.com',FRIDAY_CLOUD_CLIENT_ID:'reader.access',FRIDAY_CLOUD_CLIENT_SECRET:'private-secret'}
test('cloud checks require a root HTTPS origin and reject header injection',()=>{
 assert.equal(cloudSettings(env).origin,env.FRIDAY_CLOUD_URL)
 for(const url of ['http://internal','https://u:p@example.com','https://example.com/path','https://example.com?token=x','https://example.com/#x'])
  assert.throws(()=>cloudSettings({...env,FRIDAY_CLOUD_URL:url}))
 assert.throws(()=>cloudSettings({...env,FRIDAY_CLOUD_CLIENT_SECRET:'bad\nheader'}))
 assert.throws(()=>cloudSettings({...env,FRIDAY_CLOUD_CLIENT_ID:''}))
})
test('curl gets secrets through stdin only, retains proxy/TLS defaults, never follows redirects',()=>{
 const settings=cloudSettings(env)
 const result=cloudRequest(settings,'/api/health',{execImpl:(command,args,options)=>{
  assert.equal(command,'curl');assert.deepEqual(args,['--disable','--config','-'])
  assert.match(options.input,/CF-Access-Client-Secret: private-secret/)
  assert.doesNotMatch(options.input,/insecure|location|noproxy/)
  assert.equal(options.env,undefined)
  return {status:0,stdout:'{"service":"friday-automation","mode":"live"}\n200'}
 }})
 assert.equal(result.status,200)
 assert.throws(()=>cloudRequest(settings,'/arbitrary'))
})
test('acceptance checks enforce live identity, missing-auth denial and restricted routes',()=>{
 const checks=[]
 const request=(path,options={})=>{
  checks.push([path,options])
  if(options.auth===false)return {status:403}
  if(options.method==='POST')return {status:405}
  if(path==='/api/repositories')return {status:404}
  return {status:200,body:path==='/api/health'?{service:'friday-automation',mode:'live'}:path==='/api/overview'?{mode:'live',generatedAt:'2026-10-25T00:00:00Z',services:[]}:{}}
 }
 assert.equal(checkConnection(request).length,7)
 assert.equal(checks.length,7)
 assert.throws(()=>checkConnection(()=>({status:200,body:{service:'friday-automation',mode:'mock'}})))
 assert.throws(()=>checkConnection((path,options)=>options?.auth===false?{status:200}:request(path,options)))
})
