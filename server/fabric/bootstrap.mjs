import {FabricPolicyError} from './manifest-validation.mjs'
import {buildAgentContext} from './context-builder.mjs'
const missing=()=>{throw new FabricPolicyError('fabric-unavailable')}
export function createFabricRuntime({enabled=false,catalog,services,serverCeilings}={}){
 const complete=enabled===true&&catalog?.status==='ok'&&
  typeof catalog.policyHash==='string'&&catalog.policyHash.length>0&&
  catalog.catalog?.policyHash===catalog.policyHash&&
  typeof services?.registryService?.get==='function'&&
  typeof services?.workService?.get==='function'&&
  typeof services?.workService?.getLatestHandoff==='function'&&
  typeof services?.decisionService?.listAccepted==='function'&&
  typeof services?.memoryService?.search==='function'&&
  serverCeilings&&typeof serverCeilings==='object'
 return Object.freeze({
  enabled:Boolean(complete),
  async buildContext(input={}){
   if(!complete)missing()
   // Rebind privileged services and ceiling *after* untrusted input.
   return buildAgentContext({...input,
    catalog:catalog.catalog,serverCeilings,
    registryService:services.registryService,
    workService:services.workService,
    decisionService:services.decisionService,
    memoryService:services.memoryService,
   })
  },
 })
}
