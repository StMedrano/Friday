import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateCatalog} from './validate-fabric-catalog.mjs'
test('validator loads only an approved local directory catalog',async()=>{
 const result=await validateCatalog()
 assert.equal(result.status,'ok')
 assert.equal(result.groups,1)
 assert.equal(result.skills,1)
 assert.equal(result.plugins,2)
})
test('invalid fixture results in a safe rejected validation',async()=>{
 const path=await mkdtemp(join(tmpdir(),'friday-unsafe-catalog-'))
 try{await assert.rejects(validateCatalog({rootDir:path}),e=>e.kind==='catalog-invalid')}finally{await rm(path,{recursive:true,force:true})}
})
