import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createNvidiaProvider } from '../server/ai/nvidia.mjs'

const ID=/^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,128}$/
const FIXED_BASE_URL='https://integrate.api.nvidia.com/v1'
export const keyFileDefault=join(homedir(),'.config','friday','nvidia-api.key')

// One optional single-request smoke test. No model invocation unless the
// operator confirms the provider's current billing terms AND explicitly opts in.
export async function checkNvidiaHosted({
 env=process.env,
 keyFile=keyFileDefault,
 readFileImpl=readFile,
 statImpl=stat,
 fetchImpl=fetch,
 uid=process.getuid?.(),
}={}){
 if(env.FRIDAY_NVIDIA_ALLOW_ONE_LIVE_TEST!=='yes')return {ok:false,reason:'explicit-inference-consent-required'}
 if(env.FRIDAY_NVIDIA_VERIFIED_FREE!=='yes')return {ok:false,reason:'free-tier-not-verified'}
 const model=String(env.FRIDAY_NVIDIA_SMOKE_MODEL||'')
 if(!ID.test(model))return {ok:false,reason:'model-id-not-configured'}
 let key
 try {
  const meta=await statImpl(keyFile)
  if(!meta.isFile() || (meta.mode&0o077)!==0 || (uid!==undefined&&meta.uid!==uid))return {ok:false,reason:'private-key-file-required'}
  key=String(await readFileImpl(keyFile,'utf8')).trim()
  if(key.length<20||key.length>4096||/\s/.test(key))return {ok:false,reason:'invalid-key-file'}
 }catch{return {ok:false,reason:'private-key-file-required'}}
 try{
  const provider=createNvidiaProvider({fetchImpl})
  const response=await provider.generate({
   providerConfig:{deployment:'hosted',baseUrl:FIXED_BASE_URL,apiKey:key,model,maxTokens:8},
   request:{messages:[{role:'user',content:'Reply with just OK.'}],maxTokens:8},
   signal:AbortSignal.timeout(15000),
  })
  return {ok:typeof response.text==='string'&&response.text.length>0,reason:'hosted-model-responded',model}
 }catch(e){
  // Do not emit responses, headers, stack traces, keys, or model outputs.
  return {ok:false,reason:'hosted-model-unavailable',kind:e?.kind||'unknown'}
 }finally{key=undefined}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await checkNvidiaHosted()
 process.stdout.write(JSON.stringify(result)+'\n')
 if(!result.ok)process.exitCode=2
}
