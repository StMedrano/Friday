import {fileURLToPath} from 'node:url'
import {dirname,resolve} from 'node:path'
import {loadFabricCatalog} from '../server/fabric/catalog-loader.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export async function validateCatalog({rootDir=root}={}){
 const loaded=await loadFabricCatalog({rootDir})
 return {
  status:loaded.status,policyHash:loaded.policyHash,
  groups:Object.keys(loaded.catalog.groups).length,
  skills:Object.keys(loaded.catalog.skills).length,
  plugins:Object.keys(loaded.catalog.plugins).length,
  assignments:Object.keys(loaded.catalog.assignments).length,
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await validateCatalog()))}
 catch{console.error('Friday fabric catalog validation failed');process.exitCode=1}
}
