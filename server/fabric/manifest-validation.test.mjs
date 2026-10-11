import test from 'node:test'
import assert from 'node:assert/strict'
import {parseManifestJson,validateFabricManifest,FabricPolicyError} from './manifest-validation.mjs'

const group={schemaVersion:'1',id:'engineering',requiredSkills:['safe-code-review'],optionalSkills:[],allowedPluginCapabilities:['github.repository.read'],deniedPluginCapabilities:[],memoryScopes:['project','task'],requiredProcessRules:['review-before-merge']}
const skill={schemaVersion:'1',id:'safe-code-review',version:'1.0.0',instructionFile:'SKILL.md',description:'Code review SOP',required:true,dependencies:[]}
const plugin={schemaVersion:'1',id:'github',capabilities:['github.repository.read'],risk:'low',connectionType:'api',enabled:false,description:'GitHub read only'}
const assignment={schemaVersion:'1',agentId:'proxmox-observer',groupId:'engineering',skills:[],allowedPluginCapabilities:[],deniedPluginCapabilities:[],allowedMemoryScopes:[{scope:'project',ownerId:'prj-a'}]}

test('parses ordinary JSON but rejects duplicate member keys including escaped member names',()=>{
 assert.deepEqual(parseManifestJson('{"id":"review","a":{"name":"safe"}}'),{id:'review',a:{name:'safe'}})
 for(const s of ['{"id":"review","id":"admin"}','{"id":"safe","\\u0069d":"admin"}','{"nested":{"x":1,"x":2}}']) assert.throws(()=>parseManifestJson(s),e=>e.kind==='catalog-invalid')
})
test('fails for invalid encodings, excessive nesting, bad JSON and prototype pollution keys',()=>{
 for(const x of [Buffer.from([0xff]),'{"__proto__":1}','{"x": [true,}}','['.repeat(80)+']'.repeat(80)]) assert.throws(()=>parseManifestJson(x),e=>e.kind==='catalog-invalid')
})
test('valid group skill plugin and assignment are frozen and normalized',()=>{
 for(const [type,row] of [['group',group],['skill',skill],['plugin',plugin],['assignment',assignment]]){
  const v=validateFabricManifest(type,row)
  assert.equal(Object.isFrozen(v),true)
  assert.equal(Object.isFrozen(Object.values(v).find(Array.isArray)),true)
  assert.deepEqual(v,row)
 }
})
test('rejects unknown fields, schema version and sensitive or execution-bearing manifest values',()=>{
 for(const [type,row] of [['group',{...group,schemaVersion:'2'}],['group',{...group,script:'rm -rf /'}],['skill',{...skill,instructionFile:'../secret'}],['plugin',{...plugin,authorization:'Bearer example'}],['assignment',{...assignment,skills:['safe-code-review','safe-code-review']}]]) assert.throws(()=>validateFabricManifest(type,row),e=>e instanceof FabricPolicyError&&e.kind==='catalog-invalid')
})
test('no wildcards unicode or partial capability names can be authorized',()=>{
 for(const cap of ['github.read*','github.read.','github..read','Github.read','github.réad','github','*','github.repository.read/other']){
  assert.throws(()=>validateFabricManifest('plugin',{...plugin,capabilities:[cap]}),e=>e.kind==='catalog-invalid')
 }
})
test('scope owner fields must be exact and assignments cannot invent permission',()=>{
 for(const p of [{scope:'project',ownerId:'*'},{scope:'project',ownerId:'../etc'},{scope:'invented',ownerId:'a'}])assert.throws(()=>validateFabricManifest('assignment',{...assignment,allowedMemoryScopes:[p]}),e=>e.kind==='catalog-invalid')
 assert.throws(()=>validateFabricManifest('agent',{...assignment}),e=>e.kind==='catalog-invalid')
})
test('normalizes declared skill dependency objects to exact version-pinned IDs',()=>{
 const normalized=validateFabricManifest('skill',{...skill,dependencies:[{id:'basic-review',version:'1.0.0'}]})
 assert.deepEqual(normalized.dependencies,['basic-review@1.0.0'])
})

test('rejects bidi and invisible C1 controls in human-readable manifest descriptions',()=>{
 for(const unsafe of ['\u202e','\u2067','\u0085']){
  for(const [kind,row] of [['skill',skill],['plugin',plugin]]){
   assert.throws(()=>validateFabricManifest(kind,{...row,description:'Reviewed '+unsafe+'unsafe'}),e=>e.kind==='catalog-invalid')
  }
 }
})
