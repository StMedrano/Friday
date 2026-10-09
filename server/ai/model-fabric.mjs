import {buildModelTargets,publicModelDescriptor} from './model-registry.mjs'
import {rankEligibleModelTargets} from './model-router.mjs'
import {createNvidiaProvider} from './nvidia.mjs'
import {ProviderUnavailableError} from './errors.mjs'

// Internal only. Never exported as an HTTP API or wired into existing assistant/agent paths.
export function createModelFabric({config={},providers,fetchImpl,signalFactory}={}) {
  const modelConfig=config.modelFabric || {}
  const registry=buildModelTargets(modelConfig)
  const adapters=providers || {nvidia:createNvidiaProvider({fetchImpl})}
  const createSignal=signalFactory || (ms => {
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),ms)
    return {signal:controller.signal,dispose:()=>clearTimeout(timeout)}
  })
  function eligible(requirements) {
    if(modelConfig.enabled !== true) return []
    return rankEligibleModelTargets({targets:registry,requirements,policy:modelConfig.policy})
  }
  function listEligible(requirements={capabilities:[]}) {
    return eligible(requirements).map(publicModelDescriptor)
  }
  async function generate({requirements={capabilities:[]},request}={}) {
    const attempts=[]
    for(const target of eligible(requirements)) {
      const {descriptor:d,providerConfig}=target
      const adapter=adapters[d.provider]
      if(!adapter || typeof adapter.health!=='function' || typeof adapter.generate!=='function') {
        attempts.push({modelId:d.id,provider:d.provider,outcome:'configuration'})
        continue
      }
      const budget=d.deployment==='local' ? config.ai?.localTimeoutMs : config.ai?.cloudTimeoutMs
      const timeout=Number.isSafeInteger(budget) && budget>0 ? budget : d.deployment==='local'?45000:15000
      let resource
      try {
        resource=createSignal(timeout)
        await adapter.health({providerConfig,signal:resource.signal})
        const response=await adapter.generate({providerConfig,request,signal:resource.signal})
        if(typeof response?.text!=='string' || !response.text.trim()) {
          attempts.push({modelId:d.id,provider:d.provider,outcome:'invalid-response'})
          continue
        }
        attempts.push({modelId:d.id,provider:d.provider,outcome:'success'})
        return {available:true,provider:d.provider,modelId:d.id,model:providerConfig.model,text:response.text,attempts}
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) {
          attempts.push({modelId:d.id,provider:d.provider,outcome:'internal-error'})
          return {available:false,error:'model-fabric-error',attempts}
        }
        attempts.push({modelId:d.id,provider:d.provider,outcome:error.kind})
      } finally {
        resource?.dispose?.()
      }
    }
    return {available:false,error:'no-free-model-available',attempts}
  }
  return Object.freeze({listEligible,generate})
}