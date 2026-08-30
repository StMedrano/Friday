import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupabaseRegistryClient } from './supabase-client.mjs'

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body } }
}

test('registry client sends server-only PostgREST auth headers and lists agents', async () => {
  let request
  const client = createSupabaseRegistryClient({
    baseUrl: 'http://supabase.local',
    serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return response([{ id: 'proxmox-observer' }])
    },
  })

  assert.deepEqual(await client.listAgents(), [{ id: 'proxmox-observer' }])
  assert.equal(request.url, 'http://supabase.local/rest/v1/friday_agents?select=*')
  assert.equal(request.options.headers.apikey, 'secret')
  assert.equal(request.options.headers.authorization, 'Bearer secret')
  assert.equal(request.options.headers['content-type'], 'application/json')
})

test('registry client encodes agent ids and restricts lookup to the agent table', async () => {
  let request
  const client = createSupabaseRegistryClient({
    baseUrl: 'http://supabase.local/',
    serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      request = { url, options }
      return response([{ id: 'agent/a' }])
    },
  })

  assert.deepEqual(await client.getAgent('agent/a'), { id: 'agent/a' })
  assert.equal(request.url, 'http://supabase.local/rest/v1/friday_agents?id=eq.agent%2Fa&select=*')
})

test('registry client upserts only approved Friday registry resources', async () => {
  const requests = []
  const client = createSupabaseRegistryClient({
    baseUrl: 'http://supabase.local',
    serviceKey: 'secret',
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return response([])
    },
  })

  await client.upsertAgent({ id: 'proxmox-observer', name: 'Proxmox Observer' })
  await client.upsertRegistryState({ id: 'current', last_sync_status: 'ok' })
  await client.getRegistryState()

  assert.match(requests[0].url, /\/rest\/v1\/friday_agents\?on_conflict=id$/)
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(requests[0].options.headers.prefer, 'resolution=merge-duplicates,return=representation')
  assert.match(requests[1].url, /\/rest\/v1\/friday_agent_registry_state\?on_conflict=id$/)
  assert.equal(requests[2].url, 'http://supabase.local/rest/v1/friday_agent_registry_state?id=eq.current&select=*')
})

test('registry client normalizes upstream errors without leaking the service key', async () => {
  const client = createSupabaseRegistryClient({
    baseUrl: 'http://supabase.local',
    serviceKey: 'very-secret-key',
    fetchImpl: async () => response({ message: 'database says very-secret-key' }, { ok: false, status: 500 }),
  })

  await assert.rejects(
    () => client.listAgents(),
    (error) => error.code === 'FRIDAY_AGENT_REGISTRY_UNAVAILABLE' && !error.message.includes('very-secret-key'),
  )
})
