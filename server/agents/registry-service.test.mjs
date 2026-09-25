import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentRegistryService } from './registry-service.mjs'

const row = {
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  description: 'Read-only Proxmox diagnostics.',
  spec_version: '1.1',
  source_path: 'agents/proxmox-observer.json',
  source_checksum: 'abc123',
  enabled: true,
  model_profile: 'local-general',
  scope_json: { hosts: ['proxmox'] },
  tools_json: ['proxmox_read'],
  permissions_json: { inspect: 'auto', restart_vm: 'approval' },
  instructions_json: ['Inspect first.'],
  synced_at: '2026-08-30T20:00:00.000Z',
}

function fakeClient() {
  return {
    async listAgents() { return [row] },
    async getAgent(id) { return id === row.id ? row : null },
    async getRegistryState() {
      return {
        id: 'current',
        last_sync_at: '2026-08-30T20:00:00.000Z',
        last_sync_status: 'ok',
        source_commit: 'abc123',
        agents_seen: 1,
        agents_synced: 1,
        agents_rejected: 0,
        error_summary: [],
      }
    },
  }
}

test('registry service returns sanitized camelCase agent definitions for runtime and UI', async () => {
  const service = createAgentRegistryService({ registryClient: fakeClient() })
  assert.deepEqual(await service.list(), [{
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
    source: {
      path: 'agents/proxmox-observer.json',
      checksum: 'abc123',
      syncedAt: '2026-08-30T20:00:00.000Z',
    },
  }])
  assert.equal(JSON.stringify(await service.list()).includes('serviceKey'), false)
})

test('registry service returns null for an unknown agent and normalizes registry status', async () => {
  const service = createAgentRegistryService({ registryClient: fakeClient() })
  assert.equal(await service.get('missing'), null)
  assert.deepEqual(await service.status(), {
    id: 'current',
    status: 'ok',
    lastSyncAt: '2026-08-30T20:00:00.000Z',
    sourceCommit: 'abc123',
    agentsSeen: 1,
    agentsSynced: 1,
    agentsRejected: 0,
    errors: [],
  })
})

test('registry service explicit sync delegates only to the configured sync implementation', async () => {
  let calls = 0
  const service = createAgentRegistryService({
    registryClient: fakeClient(),
    syncContext: { agentsDir: '/app/agents', sourceCommit: 'abc123' },
    syncImpl: async (context) => {
      calls += 1
      assert.equal(context.agentsDir, '/app/agents')
      return { status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] }
    },
  })

  assert.deepEqual(await service.sync(), { status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] })
  assert.equal(calls, 1)
})
