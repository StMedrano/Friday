import test from 'node:test'
import assert from 'node:assert/strict'
import { checkNvidiaHosted } from './check-nvidia-catalog.mjs'

const key='nvapi-'+'x'.repeat(48)
const model='meta/llama-3.1-8b-instruct'
const baseEnv={FRIDAY_NVIDIA_ALLOW_ONE_LIVE_TEST:'yes',FRIDAY_NVIDIA_VERIFIED_FREE:'yes',FRIDAY_NVIDIA_SMOKE_MODEL:model}
const file={isFile:()=>true,mode:0o100600,uid:1000}
test('no hosted inference without explicit opt-in and verified free account tier',async()=>{
 let calls=0
 const deps={uid:1000,statImpl:async()=>{calls++;return file},readFileImpl:async()=>key,fetchImpl:async()=>{calls++;throw Error('must not call')}}
 assert.equal((await checkNvidiaHosted({...deps,env:{...baseEnv,FRIDAY_NVIDIA_ALLOW_ONE_LIVE_TEST:'no'}})).reason,'explicit-inference-consent-required')
 assert.equal((await checkNvidiaHosted({...deps,env:{...baseEnv,FRIDAY_NVIDIA_VERIFIED_FREE:'no'}})).reason,'free-tier-not-verified')
 assert.equal((await checkNvidiaHosted({...deps,env:{...baseEnv,FRIDAY_NVIDIA_SMOKE_MODEL:'evil url'}})).reason,'model-id-not-configured')
 assert.equal(calls,0)
})
test('private file mode and owner required, no network on key-file failure',async()=>{
 let calls=0
 const deps={uid:1000,env:baseEnv,readFileImpl:async()=>key,fetchImpl:async()=>{calls++;throw Error('must not call')}}
 for(const statImpl of [async()=>({...file,mode:0o100644}),async()=>({...file,uid:2000}),async()=>({...file,isFile:()=>false})]){
  assert.equal((await checkNvidiaHosted({...deps,statImpl})).reason,'private-key-file-required')
 }
 assert.equal(calls,0)
})
test('one bounded live request uses fixed hosted NVIDIA origin and redacts response',async()=>{
 let count=0
 const r=await checkNvidiaHosted({
  uid:1000,env:baseEnv,statImpl:async()=>file,readFileImpl:async()=>key,
  fetchImpl:async(url,init)=>{
   count++
   assert.equal(url,'https://integrate.api.nvidia.com/v1/chat/completions')
   assert.equal(init.redirect,'error')
   assert.equal(init.headers.Authorization,'Bearer '+key)
   const body=JSON.parse(init.body)
   assert.equal(body.model,model)
   assert.equal(body.max_tokens,8)
   assert.equal(body.messages[0].content,'Reply with just OK.')
   return new Response(JSON.stringify({choices:[{message:{content:'A SECRET RESPONSE'}}]}))
  }
 })
 assert.deepEqual(r,{ok:true,reason:'hosted-model-responded',model})
 assert.equal(count,1)
 assert.doesNotMatch(JSON.stringify(r),/SECRET|nvapi-/)
})
test('hosted refusal/upstream error never discloses key or response bodies',async()=>{
 const r=await checkNvidiaHosted({uid:1000,env:baseEnv,statImpl:async()=>file,readFileImpl:async()=>key,
  fetchImpl:async()=>new Response('PRIVATE '+key,{status:401})})
 assert.equal(r.ok,false)
 assert.equal(r.kind,'authentication')
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE|nvapi-/)
})
