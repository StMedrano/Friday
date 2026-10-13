import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateSharedWorkSchema} from './validate-shared-work-schema.mjs'
const sql=readFileSync('supabase/migrations/202610090001_friday_shared_work.sql','utf8')
test('shared-work migration has nine private tables and RLS',()=>{
 assert.deepEqual(validateSharedWorkSchema(sql),{ok:true,errors:[]})
})
test('rejects missing table, RLS, grants or sessions persisted',()=>{
 for(const broken of [
  sql.replace('create table public.friday_memories','create table public.friday_removed'),
  sql.replace('alter table public.friday_memories enable row level security;',''),
  sql.replace('revoke all on public.friday_memories from public, anon, authenticated;','grant all on public.friday_memories to public;'),
  sql.replace("scope <> 'session'","scope <> 'nonsense'"),
 ])assert.equal(validateSharedWorkSchema(broken).ok,false)
})
test('rejects changes to Phase 1 registry and unsafe functions',()=>{
 for(const extra of ['alter table public.friday_agents add column foo text;', 'security definer','grant execute on all functions in schema public to public;']) {
  assert.equal(validateSharedWorkSchema(sql+'\n'+extra).ok,false)
 }
})