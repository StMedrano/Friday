import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from '../config.mjs'
import { createSupabaseWorkReadRepository } from './read-only-repository.mjs'

const base = 'https://supabase.mytechtactics.com'
const task = { id: 'task-1', project_id: 'app-builder', title: 'Plan the booking flow', status: 'ready', version: 1 }

test('the gateway key authorises the request and the read key selects the read-only role', async () => {
  const seen = []
  const fetchImpl = async (url, options) => {
    seen.push({ url, headers: options.headers, method: options.method })
    return new Response(JSON.stringify([task]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const repository = createSupabaseWorkReadRepository({ baseUrl: base, readKey: 'reader-jwt', gatewayKey: 'gateway-anon-key', fetchImpl })
  const rows = await repository.list({ projectId: 'app-builder', limit: 5 })
  assert.deepEqual(rows, [{ id: 'task-1', projectId: 'app-builder', title: 'Plan the booking flow', status: 'ready', version: 1 }])
  assert.equal(seen[0].method, 'GET')
  assert.equal(seen[0].headers.apikey, 'gateway-anon-key')
  assert.equal(seen[0].headers.authorization, 'Bearer reader-jwt')
})

test('without a gateway key the read key is used for both headers', async () => {
  const seen = []
  const fetchImpl = async (url, options) => { seen.push(options.headers); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }) }
  const repository = createSupabaseWorkReadRepository({ baseUrl: base, readKey: 'reader-jwt', fetchImpl })
  await repository.list({ projectId: 'app-builder', limit: 5 })
  assert.equal(seen[0].apikey, 'reader-jwt')
  assert.equal(seen[0].authorization, 'Bearer reader-jwt')
})

test('config reads the work bridge settings server-side and stays off by default', () => {
  assert.deepEqual(getConfig({}).work, { enabled: false, readKey: '', gatewayKey: '', grantsPath: '/data/work-grants.json' })
  assert.deepEqual(getConfig({
    FRIDAY_WORK_READ_ENABLED: 'true', FRIDAY_WORK_READ_KEY: 'reader-jwt',
    FRIDAY_WORK_READ_GATEWAY_KEY: 'anon', FRIDAY_WORK_GRANTS_PATH: '/data/grants.json',
  }).work, { enabled: true, readKey: 'reader-jwt', gatewayKey: 'anon', grantsPath: '/data/grants.json' })
})

test('compose passes every work setting through to the controller', async () => {
  const compose = await (await import('node:fs/promises')).readFile(new URL('../../compose.yaml', import.meta.url), 'utf8')
  for (const key of ['FRIDAY_WORK_READ_ENABLED', 'FRIDAY_WORK_READ_KEY', 'FRIDAY_WORK_READ_GATEWAY_KEY', 'FRIDAY_WORK_GRANTS_PATH']) {
    assert.match(compose, new RegExp(`^\\s+${key}: \\$\\{${key}`, 'm'), key)
  }
})
