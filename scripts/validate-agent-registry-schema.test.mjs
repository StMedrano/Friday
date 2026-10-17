import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAgentRegistrySchema } from './validate-agent-registry-schema.mjs'

const validSchema = `
create table if not exists public.friday_agents (
  id text primary key,
  name text not null,
  description text not null default '',
  spec_version text not null,
  source_path text not null,
  source_checksum text not null,
  enabled boolean not null default true,
  model_profile text not null,
  scope_json jsonb not null,
  tools_json jsonb not null,
  permissions_json jsonb not null,
  instructions_json jsonb not null,
  synced_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create table if not exists public.friday_agent_registry_state (
  id text primary key,
  last_sync_at timestamptz,
  last_sync_status text not null,
  source_commit text,
  agents_seen integer not null,
  agents_synced integer not null,
  agents_rejected integer not null,
  error_summary jsonb not null
);
`

test('accepts exactly the two approved Phase 1 agent registry tables and required columns', () => {
  const result = validateAgentRegistrySchema(validSchema)
  assert.equal(result.ok, true)
  assert.deepEqual(result.tables, ['friday_agent_registry_state', 'friday_agents'])
  assert.deepEqual(result.errors, [])
})

test('rejects an extra action approval task memory or executor table', () => {
  for (const table of ['friday_agent_actions', 'agent_approvals', 'agent_tasks', 'agent_memory', 'agent_executor']) {
    const result = validateAgentRegistrySchema(`${validSchema}\ncreate table public.${table} (id text primary key);`)
    assert.equal(result.ok, false, `${table} must be rejected`)
    assert.ok(result.errors.some((error) => /forbidden|unexpected/i.test(error)))
  }
})

test('rejects missing required registry columns', () => {
  const result = validateAgentRegistrySchema(validSchema.replace('source_checksum text not null,', ''))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('friday_agents.source_checksum')))
})

test('rejects any third table even when its name looks harmless', () => {
  const result = validateAgentRegistrySchema(`${validSchema}\ncreate table public.friday_agent_notes (id text primary key);`)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /unexpected table/i.test(error)))
})
