import test from 'node:test'
import assert from 'node:assert/strict'
import {createModelFabric} from './model-fabric.mjs'
import {providerFailure} from './errors.mjs'

const descriptor=(id,billingClass='free',deployment='hosted')=>({id,model:`vendor/${id}`,billingClass,capabilities:['general'],supportsTools:false,supportsVision:false})
const config=(hosted=[],local=[])=>({
  ai:{cloudTimeoutMs:1200,localTimeoutMs:2500},
  modelFabric:{enabled:true,policy:{freeOnly:true,preferLocal:true,preferNvidiaFree:true},nvidia:{
    enabled:true,baseUrl:'https://integrate.api.nvidia.com/v1',apiKey:'private-secret',models:hosted,
    localEnabled:true,localBaseUrl:'http://nvidia-nim:8000/v1',localModels:local,
  }},
})
const input={requirements:{capabilities:['general']},request:{messages:[{role:'user',content:'hello'}]}}

test('empty, disabled and only paid/unknown targets safely exhaust',async()=>{
  for(const c of [config([]),config([descriptor('paid','paid'),descriptor('unknown','unknown')]),
    {...config([descriptor('free')]),modelFabric:{...config([descriptor('free')]).modelFabric,enabled:false}}]) {
    const fabric=createModelFabric({config:c,providers:{nvidia:{health:async()=>{throw Error('must not call')}}}})
    assert.deepEqual(await fabric.generate(input),{available:false,error:'no-free-model-available',attempts:[]})
  }
})
test('free failover skips paid provider and sanitizes attempted outcomes',async()=>{
  const calls=[]
  const provider={
    health:async({providerConfig})=>{calls.push('health:'+providerConfig.model);return {healthy:true}},
    generate:async({providerConfig})=>{
      calls.push('generate:'+providerConfig.model)
      if(providerConfig.model==='vendor/first') throw providerFailure('nvidia','rate-limited')
      return {provider:'nvidia',model:providerConfig.model,text:'success'}
    },
  }
  const fabric=createModelFabric({config:config([descriptor('first'),descriptor('paid','paid'),descriptor('second')]),providers:{nvidia:provider}})
  const result=await fabric.generate(input)
  assert.equal(result.available,true)
  assert.equal(result.modelId,'second')
  assert.equal(result.text,'success')
  assert.deepEqual(result.attempts,[
    {modelId:'first',provider:'nvidia',outcome:'rate-limited'},
    {modelId:'second',provider:'nvidia',outcome:'success'},
  ])
  assert.deepEqual(calls,['health:vendor/first','generate:vendor/first','health:vendor/second','generate:vendor/second'])
  assert.equal(JSON.stringify(result).includes('private-secret'),false)
})
test('unhealthy free model is skipped; no raw error data escapes',async()=>{
  const provider={
    health:async({providerConfig})=>providerConfig.model==='vendor/first'
      ? Promise.reject(providerFailure('nvidia','model-unavailable','SECRET-NO'))
      : {healthy:true},
    generate:async()=>({provider:'nvidia',model:'vendor/second',text:'ok'}),
  }
  const result=await createModelFabric({config:config([descriptor('first'),descriptor('second')]),providers:{nvidia:provider}}).generate(input)
  assert.equal(result.modelId,'second')
  assert.equal(JSON.stringify(result).includes('SECRET-NO'),false)
  assert.deepEqual(result.attempts[0],{modelId:'first',provider:'nvidia',outcome:'model-unavailable'})
})
test('local and hosted use separate signal deadlines; local wins',async()=>{
  const calls=[]
  const fabric=createModelFabric({
    config:config([descriptor('host')],[descriptor('local')]),
    providers:{nvidia:{
      health:async({signal})=>{calls.push(signal.budget);return {healthy:true}},
      generate:async({providerConfig,signal})=>{calls.push(signal.budget);return {provider:'nvidia',model:providerConfig.model,text:'ok'}},
    }},
    signalFactory:(budget)=>({signal:{budget},dispose:()=>{}}),
  })
  assert.deepEqual(fabric.listEligible({capabilities:['general']}).map(d=>d.id),['local','host'])
  assert.equal((await fabric.generate(input)).modelId,'local')
  assert.deepEqual(calls,[2500,2500])
})
test('unexpected errors fail closed; only known provider errors allow failover',async()=>{
  let invoked=0
  const fabric=createModelFabric({config:config([descriptor('first'),descriptor('second')]),
    providers:{nvidia:{health:async()=>({healthy:true}),generate:async()=>{invoked++;throw Error('sensitive stack') }}}})
  const result=await fabric.generate(input)
  assert.deepEqual(result,{available:false,error:'model-fabric-error',attempts:[{modelId:'first',provider:'nvidia',outcome:'internal-error'}]})
  assert.equal(invoked,1)
})