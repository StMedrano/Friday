import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises'
import {join,resolve,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {verifyFabricDormant} from './verify-fabric-dormant.mjs'

const source=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const dirs=['groups','skills/engineering','plugin-catalog','agent-assignments']
const paths=['server/index.mjs','server/http.mjs','server/config.mjs','Dockerfile','compose.yaml','compose.live.yaml','.env.example']
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'friday-fabric-dormant-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 for(const directory of dirs)await cp(join(source,directory),join(root,directory),{recursive:true})
 for(const filename of paths){
  await mkdir(dirname(join(root,filename)),{recursive:true})
  await cp(join(source,filename),join(root,filename))
 }
 return root
}
async function edit(root,path,content){
 await writeFile(join(root,path),content,'utf8')
}
test('merged Phase 2C catalog passes a dormant-only release audit without authorizing rollout',async()=>{
 const report=await verifyFabricDormant({rootDir:source})
 assert.equal(report.status,'dormant-verified')
 assert.equal(report.activationApproved,false)
 assert.equal(report.catalog.assignments,0)
 assert.equal(report.catalog.enabledPlugins,0)
 assert.match(report.catalog.policyHash,/^[a-f0-9]{64}$/)
})
test('preflight rejects an enabled plugin',async t=>{
 const root=await fixture(t),file='plugin-catalog/github.json'
 const row=JSON.parse(await readFile(join(root,file),'utf8'))
 row.enabled=true
 await edit(root,file,JSON.stringify(row))
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})
test('preflight rejects an agent assignment even when the manifest is valid',async t=>{
 const root=await fixture(t)
 const agent={schemaVersion:'1',agentId:'example-agent',groupId:'engineering',skills:[],allowedPluginCapabilities:[],deniedPluginCapabilities:[],allowedMemoryScopes:[]}
 await edit(root,'agent-assignments/example-agent.json',JSON.stringify(agent))
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})
test('preflight rejects HTTP server wiring of a fabric runtime',async t=>{
 const root=await fixture(t),file='server/http.mjs'
 await edit(root,file,(await readFile(join(root,file),'utf8'))+"\nimport {createFabricRuntime} from './fabric/bootstrap.mjs'\n")
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})
test('preflight rejects explicit phase2c activation in compose or env example',async t=>{
 for(const file of ['compose.live.yaml','.env.example']){
  const root=await fixture(t)
  await edit(root,file,(await readFile(join(root,file),'utf8'))+'\n'+(file.endsWith('.yaml')?'      FRIDAY_FABRIC_ENABLED: true':'FRIDAY_FABRIC_ENABLED=true')+'\n')
  await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
 }
})
test('preflight catches missing runtime catalog packaging',async t=>{
 const root=await fixture(t),file='Dockerfile'
 await edit(root,file,(await readFile(join(root,file),'utf8')).replace('COPY --from=build /app/agent-assignments ./agent-assignments',''))
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})
test('preflight fails closed for an invalid Git catalog',async t=>{
 const root=await fixture(t)
 await edit(root,'groups/engineering.json','not json')
 await assert.rejects(verifyFabricDormant({rootDir:root}))
})

test('preflight rejects compose activation through a default-true variable expansion',async t=>{
 const root=await fixture(t)
 const file='compose.live.yaml'
 await edit(root,file,(await readFile(join(root,file),'utf8'))+'\n      FRIDAY_FABRIC_ENABLED: ${FRIDAY_FABRIC_ENABLED:-true}\n')
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})

test('dormant gate rejects alternate activation values and compose variable operators',async t=>{
 for(const [i,value] of [
  'FRIDAY_FABRIC_ENABLED: 1',
  'FRIDAY_FABRIC_ENABLED: yes',
  'FRIDAY_FABRIC_ENABLED: ${FRIDAY_FABRIC_ENABLED-true}',
  'FRIDAY_FABRIC_ENABLED: ${FRIDAY_FABRIC_ENABLED:?must-enable}',
  'FRIDAY_FABRIC_ENABLED: false',
 ].entries()){
  const root=await fixture(t)
  const file='compose.live.yaml'
  await edit(root,file,(await readFile(join(root,file),'utf8'))+'\n      '+value+'\n')
  await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/,'case '+i)
 }
})
test('Dockerfile packaging requires a real COPY instruction not a comment',async t=>{
 const root=await fixture(t),file='Dockerfile'
 const original=await readFile(join(root,file),'utf8')
 const line='COPY --from=build /app/agent-assignments ./agent-assignments'
 assert.ok(original.includes(line))
 await edit(root,file,original.replace(line,'# '+line))
 await assert.rejects(verifyFabricDormant({rootDir:root}),/dormant-safety-check-failed/)
})
