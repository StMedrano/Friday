import test from 'node:test'
import assert from 'node:assert/strict'
import {createFabricRuntime} from './bootstrap.mjs'
const catalog={status:'ok',policyHash:'approved-hash',catalog:{policyHash:'approved-hash',groups:{},skills:{},plugins:{},assignments:{}}}
test('default-off fabric denies context even if catalog exists',async()=>{
 const runtime=createFabricRuntime({catalog,services:{},serverCeilings:{}})
 assert.equal(runtime.enabled,false)
 await assert.rejects(runtime.buildContext({actor:{principalId:'operator'}}),e=>e.kind==='fabric-unavailable')
})
test('enabled fabric fails closed on missing approved catalog or trusted services',async()=>{
 for(const conf of [{enabled:true},{enabled:true,catalog:{status:'degraded',policyHash:'bad'}},{enabled:true,catalog,services:{}}]){
  const runtime=createFabricRuntime(conf)
  await assert.rejects(runtime.buildContext({}),e=>e.kind==='fabric-unavailable')
 }
})
test('enabled fabric forwards trusted services and actor to internal context only',async()=>{
 const trustedServices={registryService:{get:async()=>null},workService:{get:async()=>null,getLatestHandoff:async()=>null},decisionService:{listAccepted:async()=>[]},memoryService:{search:async()=>[]}}
 const runtime=createFabricRuntime({enabled:true,catalog,services:trustedServices,serverCeilings:{}})
 assert.equal(runtime.enabled,true)
 await assert.rejects(runtime.buildContext({actor:undefined}),e=>e.kind==='not-authorized')
 assert.equal(Object.hasOwn(runtime,'execute'),false)
 assert.equal(Object.hasOwn(runtime,'registerRoute'),false)
})
test('runtime Docker image includes immutable Git-managed Phase 2C catalogs',async()=>{
 const {readFile}=await import('node:fs/promises')
 const {fileURLToPath}=await import('node:url')
 const {resolve,dirname}=await import('node:path')
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
 const dockerfile=await readFile(resolve(root,'Dockerfile'),'utf8')
 for(const path of ['groups','skills','plugin-catalog','agent-assignments']){
  assert.ok(dockerfile.includes('COPY --from=build /app/'+path+' ./'+path),'missing runtime copy for '+path)
 }
})
