import test from 'node:test'
import assert from 'node:assert/strict'
import {encodeTaskCursor,parseTaskCursor,validateTaskPage} from './task-pagination.mjs'
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const rows=Array.from({length:51},(_,i)=>({id:id(100-i),createdAt:'2026-10-17T12:00:00.123456+00:00'}))
test('bounded keyset retains microseconds and stable UUID tie order',()=>{
 const page=validateTaskPage(rows,null)
 assert.equal(page.length,51)
 const cursor=encodeTaskCursor('project-a',rows[49])
 const parsed=parseTaskCursor(cursor,'project-a')
 assert.equal(parsed.createdAt,'2026-10-17T12:00:00.123456Z')
 assert.equal(parsed.id,rows[49].id)
 assert.deepEqual(validateTaskPage(rows.slice(50),parsed),rows.slice(50))
})
test('cursor is bounded, exact, canonical and bound to the selected project',()=>{
 const valid=encodeTaskCursor('project-a',rows[0])
 for(const value of ['','*','x'.repeat(1025),valid+'=',Buffer.from(JSON.stringify({projectId:'project-a',id:id(1),createdAt:'2026-02-30T00:00:00Z'})).toString('base64url')])assert.throws(()=>parseTaskCursor(value,'project-a'),e=>e.kind==='invalid-input')
 assert.throws(()=>parseTaskCursor(valid,'private'),e=>e.kind==='invalid-input')
 assert.equal(parseTaskCursor(undefined,'project-a'),null)
})
test('malformed, duplicate, oversized, unordered and cursor-overlapping storage fails closed',()=>{
 for(const value of [null,rows.concat(rows[0]),[rows[0],rows[0]],[rows[1],rows[0]],[{...rows[0],createdAt:'bad'}]])assert.throws(()=>validateTaskPage(value,null),e=>e.kind==='storage-unavailable')
 assert.throws(()=>validateTaskPage([rows[0]],parseTaskCursor(encodeTaskCursor('project-a',rows[0]),'project-a')),e=>e.kind==='storage-unavailable')
})
