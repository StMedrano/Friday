import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveSkillInstructions} from './skill-resolver.mjs'
const make=(id,dependencies=[],extra={})=>({id,version:'1.0.0',body:'Review '+id+'.',checksum:'sha-'+id,source:'skills/engineering/'+id+'/manifest.json',dependencies,...extra})
function catalogue(skills){return {skills:Object.fromEntries(skills.map(x=>[x.id,x]))}}
test('required skill and dependency are ordered before optional and requested ones',()=>{
 const c=catalogue([make('safe-code-review',['basic-review@1.0.0']),make('basic-review'),make('debug-process'),make('task-note')])
 const got=resolveSkillInstructions({catalog:c,requiredSkillIds:['safe-code-review'],optionalSkillIds:['debug-process'],taskRequestedSkillIds:['task-note'],approvedSkillIds:['task-note']})
 assert.deepEqual(got.skills.map(x=>x.id),['basic-review','safe-code-review','debug-process','task-note'])
 assert.equal(got.skills[0].required,true)
 assert.equal(got.omissions.length,0)
})
test('missing mandatory and cyclic dependencies fail closed',()=>{
 const missing=catalogue([make('safe-code-review',['missing-skill@1.0.0'])])
 assert.throws(()=>resolveSkillInstructions({catalog:missing,requiredSkillIds:['safe-code-review']}),e=>e.kind==='catalog-invalid')
 const cycle=catalogue([make('safe-code-review',['debug-process@1.0.0']),make('debug-process',['safe-code-review@1.0.0'])])
 assert.throws(()=>resolveSkillInstructions({catalog:cycle,requiredSkillIds:['safe-code-review']}),e=>e.kind==='catalog-invalid')
})
test('requested skill cannot self-approve and optional missing skill is omitted',()=>{
 const c=catalogue([make('safe-code-review'),make('unsafe-agent')])
 const got=resolveSkillInstructions({catalog:c,requiredSkillIds:['safe-code-review'],optionalSkillIds:['absent-skill'],taskRequestedSkillIds:['unsafe-agent'],approvedSkillIds:[]})
 assert.deepEqual(got.skills.map(x=>x.id),['safe-code-review'])
 assert.equal(got.omissions.length,2)
 assert.ok(got.omissions.every(x=>x.reason==='not-approved'||x.reason==='unavailable'))
})
test('duplicate skills resolve once and version mismatch is rejected',()=>{
 const c=catalogue([make('safe-code-review'),make('audit-process',['safe-code-review@9.9.9'])])
 const ok=resolveSkillInstructions({catalog:c,requiredSkillIds:['safe-code-review','safe-code-review'],optionalSkillIds:['safe-code-review']})
 assert.deepEqual(ok.skills.map(x=>x.id),['safe-code-review'])
 assert.throws(()=>resolveSkillInstructions({catalog:c,requiredSkillIds:['audit-process']}),e=>e.kind==='catalog-invalid')
})
test('required instructions cannot truncate and optional omission respects budget',()=>{
 const c=catalogue([make('safe-code-review',[],{body:'r'.repeat(300)}),make('task-note',[],{body:'x'.repeat(300)})])
 assert.throws(()=>resolveSkillInstructions({catalog:c,requiredSkillIds:['safe-code-review'],maxChars:100}),e=>e.kind==='context-too-large')
 const r=resolveSkillInstructions({catalog:c,requiredSkillIds:['safe-code-review'],optionalSkillIds:['task-note'],maxChars:350})
 assert.deepEqual(r.skills.map(x=>x.id),['safe-code-review'])
 assert.equal(r.omissions[0].reason,'budget')
})
test('same inputs produce deterministic skill results and reject more than sixteen resolved skills',()=>{
 const c=catalogue([make('safe-code-review'),...Array.from({length:17},(_,i)=>make('skill-'+String(i).padStart(3,'0')))])
 const args={catalog:c,requiredSkillIds:['safe-code-review'],optionalSkillIds:['skill-001','skill-003'],maxChars:4000}
 assert.deepEqual(resolveSkillInstructions(args),resolveSkillInstructions(args))
 assert.throws(()=>resolveSkillInstructions({catalog:c,requiredSkillIds:Object.keys(c.skills),maxChars:12000}),e=>e.kind==='catalog-invalid')
})
