import {readFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {loadFabricCatalog} from '../server/fabric/catalog-loader.mjs'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const runtimePaths=['server/index.mjs','server/http.mjs','server/config.mjs']
const deploymentPaths=['compose.yaml','compose.live.yaml','.env.example']
const copied=['groups','skills','plugin-catalog','agent-assignments']
const unsafeFabricWiring=/(?:\bcreateFabricRuntime\b|\bbuildAgentContext\b|\bloadFabricCatalog\b|(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"][^'"]*\/fabric\/)/m
const enabledEnv=/\bFRIDAY_FABRIC_ENABLED\s*[:=]\s*(?:['"]?true(?:['"]|\s|$)|['"]?\$\{FRIDAY_FABRIC_ENABLED:-true\})/im
const fail=()=>{throw new Error('dormant-safety-check-failed')}
const loadText=(base,path)=>readFile(resolve(base,path),'utf8')

/**
 * Repository-only, read-only staging gate. This is NOT a deployment
 * authorization and must never access runtime credentials or network APIs.
 */
export async function verifyFabricDormant({rootDir=root}={}){
 if(typeof rootDir!=='string'||!rootDir)fail()
 const base=resolve(rootDir)
 const validated=await loadFabricCatalog({rootDir:base})
 const {catalog,policyHash}=validated
 if(validated.status!=='ok'||!policyHash)fail()
 const plugins=Object.values(catalog.plugins)
 if(plugins.some(plugin=>plugin.enabled!==false)||Object.keys(catalog.assignments).length!==0)fail()
 for(const file of runtimePaths){
  if(unsafeFabricWiring.test(await loadText(base,file)))fail()
 }
 for(const file of deploymentPaths){
  if(enabledEnv.test(await loadText(base,file)))fail()
 }
 const dockerfile=await loadText(base,'Dockerfile')
 for(const folder of copied){
  if(!dockerfile.includes('COPY --from=build /app/'+folder+' ./'+folder))fail()
 }
 return Object.freeze({
  status:'dormant-verified',
  activationApproved:false,
  independentSecurityReviewRequired:true,
  catalog:{
   policyHash,
   groups:Object.keys(catalog.groups).length,
   skills:Object.keys(catalog.skills).length,
   plugins:plugins.length,
   enabledPlugins:0,
   assignments:0,
  },
  checks:{catalogValidated:true,defaultOffEntrypoints:true,defaultOffCompose:true,packagedCatalog:true},
 })
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await verifyFabricDormant()))}
 catch{console.error('Friday dormant release verification failed');process.exitCode=1}
}
