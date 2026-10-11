import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadFabricCatalog} from './catalog-loader.mjs'

const group={schemaVersion:'1',id:'engineering',requiredSkills:['safe-code-review'],optionalSkills:[],allowedPluginCapabilities:['github.repository.read'],deniedPluginCapabilities:[],memoryScopes:['project'],requiredProcessRules:['review-before-merge']}
const skill={schemaVersion:'1',id:'safe-code-review',version:'1.0.0',instructionFile:'SKILL.md',description:'Perform an evidence-based review',required:true,dependencies:[]}
const plugin={schemaVersion:'1',id:'github',capabilities:['github.repository.read'],risk:'low',connectionType:'api',enabled:false,description:'GitHub read capability'}
async function temp(){const root=await mkdtemp(join(tmpdir(),'friday-fabric-'));for(const dir of ['groups','skills/engineering/safe-code-review','plugin-catalog','agent-assignments'])await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,'groups/engineering.json'),JSON.stringify(group));await writeFile(join(root,'skills/engineering/safe-code-review/manifest.json'),JSON.stringify(skill));await writeFile(join(root,'skills/engineering/safe-code-review/SKILL.md'),'Review code against tests.');await writeFile(join(root,'plugin-catalog/github.json'),JSON.stringify(plugin));return root}
async function check(f){const root=await temp();try{await f(root)}finally{await rm(root,{recursive:true,force:true})}}
test('loads immutable versioned snapshot deterministically with SHA256',()=>check(async root=>{
 const a=await loadFabricCatalog({rootDir:root,sourceCommit:'abc123'});const b=await loadFabricCatalog({rootDir:root,sourceCommit:'abc123'})
 assert.equal(a.policyHash,b.policyHash);assert.equal(a.status,'ok');assert.equal(a.catalog.groups.engineering.id,'engineering')
 assert.equal(a.catalog.skills['safe-code-review'].body,'Review code against tests.')
 assert.equal(Object.isFrozen(a.catalog.skills['safe-code-review']),true)
 assert.deepEqual(Object.keys(a.catalog.assignments),[])
 assert.deepEqual(Object.keys(a.catalog.plugins),['github'])
}))
test('rejects symlinked SOP and symlinked parent directory',()=>check(async root=>{
 await rm(join(root,'skills/engineering/safe-code-review/SKILL.md'));await symlink('/etc/hosts',join(root,'skills/engineering/safe-code-review/SKILL.md'))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
}))
test('rejects symlink to nested skill directory even if targets exist',()=>check(async root=>{
 await symlink(join(root,'skills/engineering/safe-code-review'),join(root,'skills/engineering/linked'))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
}))
test('rejects missing group skills, duplicate identity, extra files, and oversized files',()=>check(async root=>{
 await writeFile(join(root,'groups/engineering.json'),JSON.stringify({...group,requiredSkills:['not-found']}))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
 await writeFile(join(root,'groups/engineering.json'),JSON.stringify(group))
 await writeFile(join(root,'groups/duplicate.json'),JSON.stringify(group))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
 await rm(join(root,'groups/duplicate.json'))
 await writeFile(join(root,'groups/unexpected.txt'),'hi')
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
 await rm(join(root,'groups/unexpected.txt'))
 await writeFile(join(root,'skills/engineering/safe-code-review/SKILL.md'),'a'.repeat(2300))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
}))
test('invalid next snapshot does not mutate accepted existing snapshot',()=>check(async root=>{
 const a=await loadFabricCatalog({rootDir:root})
 await writeFile(join(root,'groups/engineering.json'),'{"id":"bad","id":"evil"}')
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
 assert.equal(a.catalog.groups.engineering.id,'engineering')
}))
test('rejects malformed UTF-8 in manifest',()=>check(async root=>{
 await writeFile(join(root,'groups/engineering.json'),Buffer.from([0xff,0xfe]))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
}))

test('ignores existing legacy project skills outside reviewed Phase 2C skill categories',()=>check(async root=>{
 await mkdir(join(root,'skills/iterating-friday-ui')); await writeFile(join(root,'skills/iterating-friday-ui/SKILL.md'),'Existing project SOP');
 const loaded=await loadFabricCatalog({rootDir:root});
 assert.deepEqual(Object.keys(loaded.catalog.skills),['safe-code-review'])
}))
test('accepts version-pinned dependencies between validated Git skill manifests',()=>check(async root=>{
 await mkdir(join(root,'skills/engineering/basic-review'))
 await writeFile(join(root,'skills/engineering/basic-review/manifest.json'),JSON.stringify({...skill,id:'basic-review'}))
 await writeFile(join(root,'skills/engineering/basic-review/SKILL.md'),'Verify sources.')
 await writeFile(join(root,'skills/engineering/safe-code-review/manifest.json'),JSON.stringify({...skill,dependencies:[{id:'basic-review',version:'1.0.0'}]}))
 const result=await loadFabricCatalog({rootDir:root})
 assert.deepEqual(result.catalog.skills['safe-code-review'].dependencies,['basic-review@1.0.0'])
}))

test('rejects ambiguous capabilities declared by two plugin descriptors',()=>check(async root=>{
 await writeFile(join(root,'plugin-catalog/github-alt.json'),JSON.stringify({...plugin,id:'github-alt',risk:'high',enabled:true}))
 await assert.rejects(loadFabricCatalog({rootDir:root}),e=>e.kind==='catalog-invalid')
}))
