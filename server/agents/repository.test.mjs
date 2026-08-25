import test from 'node:test'
import assert from 'node:assert/strict'
import { SupabaseAgentRepository } from './repository.mjs'

test('Supabase repository maps definition rows to agents and updates cache', async () => {
  let cached = null
  const repo = new SupabaseAgentRepository({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ definition: { id: 'proxmox-observer', enabled: true } }],
    }),
    cacheRepository: {
      writeCache: async agents => { cached = agents },
      readCache: async () => [],
    },
  })

  const agents = await repo.list()
  assert.equal(agents[0].id, 'proxmox-observer')
  assert.deepEqual(cached, agents)
})

test('Supabase repository falls back to local cache when remote lookup fails', async () => {
  const repo = new SupabaseAgentRepository({
    url: 'https://example.supabase.co',
    serviceRoleKey: 'test-key',
    fetchImpl: async () => { throw new Error('offline') },
    cacheRepository: {
      writeCache: async () => {},
      readCache: async () => [{ id: 'cached-agent' }],
    },
  })

  const agents = await repo.list()
  assert.deepEqual(agents, [{ id: 'cached-agent' }])
})
