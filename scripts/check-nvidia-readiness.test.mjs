import test from 'node:test'
import assert from 'node:assert/strict'
import * as script from './check-nvidia-catalog.mjs'

const key='nvapi-'+'x'.repeat(48)
const model='meta/llama-3.1-8b-instruct'
const env={FRIDAY_NVIDIA_ALLOW_CATALOG_CHECK:'yes',FRIDAY_NVIDIA_SMOKE_MODEL:model}
const file={isFile:()=>true,mode:0o100600,uid:1000}
const deps={env,uid:1000,statImpl:async()=>file,readFileImpl:async()=>key}
async function check(options) {
 assert.equal(typeof script.checkNvidiaCatalog,'function','read-only catalog readiness check must exist')
 return script.checkNvidiaCatalog(options)
}
test('catalog check requires explicit read consent and model without reading credentials',async()=>{
 let reads=0
 const io={statImpl:async()=>{reads++;return file},readFileImpl:async()=>{reads++;return key}}
 assert.equal((await check({...io,env:{}})).reason,'explicit-catalog-consent-required')
 assert.equal((await check({...io,env:{...env,FRIDAY_NVIDIA_SMOKE_MODEL:'https://evil.invalid'}})).reason,'model-id-not-configured')
 assert.equal(reads,0)
})
test('catalog check uses one fixed GET and never sends a prompt or enables inference',async()=>{
 let calls=0
 const result=await check({...deps,fetchImpl:async(url,init)=>{
  calls++
  assert.equal(url,'https://integrate.api.nvidia.com/v1/models')
  assert.equal(init.method,'GET')
  assert.equal(init.redirect,'error')
  assert.equal(init.headers.Authorization,'Bearer '+key)
  assert.equal(init.body,undefined)
  assert.ok(init.signal instanceof AbortSignal)
  return new Response(JSON.stringify({data:[{id:model,private:'hidden'}]}))
 }})
 assert.deepEqual(result,{ok:true,reason:'catalog-model-available',model,inferenceTested:false})
 assert.equal(calls,1)
 assert.doesNotMatch(JSON.stringify(result),/nvapi-|hidden/)
})
test('catalog check refuses unsafe key files and invalid key values before network',async()=>{
 let calls=0
 const network=async()=>{calls++;throw Error('should not reach network')}
 for(const meta of [{...file,mode:0o100644},{...file,uid:2},{...file,isFile:()=>false}]) {
  assert.equal((await check({...deps,statImpl:async()=>meta,fetchImpl:network})).reason,'private-key-file-required')
 }
 for(const value of ['', 'short',key+'\n'+key]) {
  assert.equal((await check({...deps,readFileImpl:async()=>value,fetchImpl:network})).reason,'invalid-key-file')
 }
 assert.equal(calls,0)
})
test('catalog check reports absent model separately from inference readiness',async()=>{
 const result=await check({...deps,fetchImpl:async()=>new Response(JSON.stringify({data:[{id:'other/model'}]}))})
 assert.deepEqual(result,{ok:false,reason:'catalog-check-failed',kind:'model-unavailable',inferenceTested:false})
})
test('catalog HTTP errors are classified without retrying or exposing response bodies',async()=>{
 for(const [status,kind] of [[401,'authentication'],[429,'rate-limited'],[500,'upstream']]){
  let calls=0
  const result=await check({...deps,fetchImpl:async()=>{calls++;return new Response('PRIVATE '+key,{status})}})
  assert.equal(result.ok,false)
  assert.equal(result.kind,kind)
  assert.equal(result.inferenceTested,false)
  assert.equal(calls,1)
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|nvapi-/)
 }
})
test('catalog timeout, redirect refusal and malformed responses fail without leaking details',async()=>{
 const cases=[
  [async()=>{throw new DOMException('PRIVATE '+key,'TimeoutError')},'timeout'],
  [async()=>{throw Error('PRIVATE '+key)},'network'],
  [async()=>new Response('not JSON'),'invalid-response'],
 ]
 for(const [fetchImpl,kind] of cases){
  const result=await check({...deps,fetchImpl})
  assert.equal(result.ok,false)
  assert.equal(result.kind,kind)
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|nvapi-/)
 }
})
