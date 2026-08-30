import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { syncAgentRegistry } from './registry-sync.mjs'

const modelProfiles = {
  'local-general': {
    provider: 'ollama',
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 768,
  },
}

function validAgent(overrides = {}) {
  return {
    version: '1.1',
    id: 'proxmox-observer',
    name: 'Proxmox Observer',
    description: 'Read-only Proxmox diagnostics.',
    enabled: true,
    model: { profile: 'local-general' },
    scope: { hosts: ['proxmox'] },
    tools: ['proxmox_read'],
    permissions: { inspect: 'auto', restart_vm: 'approval' },
    instructions: ['Inspect first.'],
    ...overrides,
  }
}

function fakeRegistry(existing = {}) {
  const agents = new Map(Object.entries(existing))
  const upserts = []
  const states = []
  return {
    agents,
    upserts,
    states,
    async getAgent(id) { return agents.get(id) || null },
    async upsertAgent(row) { agents.set(row.id, row); upserts.push(row); return row },
    async upsertRegistryState(row) { states.push(row); return row },
  }
}

async function withAgentsDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-agents-'))
  try { return await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('syncs a valid Git agent with stable source checksum and Git-owned enabled state', async () => withAgentsDir(async (dir) => {
  const bytes = `${JSON.stringify(validAgent({ enabled: false }), null, 2)}\n`
  const path = join(dir, 'proxmox-observer.json')
  await writeFile(path, bytes)
  const registryClient = fakeRegistry()
  const now = () => new Date('2026-08-30T20:00:00.000Z')

  const result = await syncAgentRegistry({
    agentsDir: dir,
    sourceCommit: 'abc123',
    registryClient,
    modelProfiles,
    now,
  })

  assert.deepEqual(result, { status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] })
  assert.equal(registryClient.upserts.length, 1)
  const row = registryClient.upserts[0]
  assert.equal(row.id, 'proxmox-observer')
  assert.equal(row.enabled, false)
  assert.equal(row.model_profile, 'local-general')
  assert.equal(row.source_path, 'agents/proxmox-observer.json')
  assert.equal(row.source_checksum, createHash('sha256').update(await readFile(path)).digest('hex'))
  assert.equal(row.synced_at, '2026-08-30T20:00:00.000Z')
  assert.deepEqual(row.permissions_json, { inspect: 'auto', restart_vm: 'approval' })
  assert.equal(registryClient.states[0].source_commit, 'abc123')
}))

test('rejects invalid JSON and invalid model profiles without activating them', async () => withAgentsDir(async (dir) => {
  await writeFile(join(dir, 'bad-json.json'), '{ definitely not json')
  await writeFile(join(dir, 'bad-profile.json'), JSON.stringify(validAgent({ id: 'bad-profile', model: { profile: 'missing' } })))
  const registryClient = fakeRegistry()

  const result = await syncAgentRegistry({ agentsDir: dir, sourceCommit: 'def456', registryClient, modelProfiles })

  assert.equal(result.status, 'degraded')
  assert.equal(result.agentsSeen, 2)
  assert.equal(result.agentsSynced, 0)
  assert.equal(result.agentsRejected, 2)
  assert.equal(registryClient.upserts.length, 0)
  assert.deepEqual(result.errors.map((item) => item.code).sort(), ['invalid-json', 'invalid-model-profile'])
  assert.equal(result.errors.some((item) => JSON.stringify(item).includes('definitely not json')), false)
}))

test('an invalid changed definition cannot overwrite the last known valid registry row', async () => withAgentsDir(async (dir) => {
  const existing = { id: 'proxmox-observer', source_checksum: 'old-valid-checksum', enabled: true }
  const registryClient = fakeRegistry({ 'proxmox-observer': existing })
  await writeFile(join(dir, 'proxmox-observer.json'), JSON.stringify(validAgent({ permissions: { inspect: 'root' } })))

  const result = await syncAgentRegistry({ agentsDir: dir, sourceCommit: 'ghi789', registryClient, modelProfiles })

  assert.equal(result.agentsRejected, 1)
  assert.equal(registryClient.upserts.length, 0)
  assert.equal(registryClient.agents.get('proxmox-observer'), existing)
}))

test('missing Git definitions do not auto-delete existing registry rows in Phase 1', async () => withAgentsDir(async (dir) => {
  const existing = { id: 'retained-agent', source_checksum: 'known-good' }
  const registryClient = fakeRegistry({ 'retained-agent': existing })

  const result = await syncAgentRegistry({ agentsDir: dir, sourceCommit: 'empty', registryClient, modelProfiles })

  assert.deepEqual(result, { status: 'ok', agentsSeen: 0, agentsSynced: 0, agentsRejected: 0, errors: [] })
  assert.equal(registryClient.agents.get('retained-agent'), existing)
  assert.equal(registryClient.upserts.length, 0)
}))
