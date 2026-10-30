import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig } from '../config.mjs'
import { createSupabaseWorkReadRepository } from './read-only-repository.mjs'
import { createWorkGrants } from './subject-grants.mjs'

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
  const off = getConfig({}).work
  assert.deepEqual(off, { enabled: false, readKey: '', gatewayKey: '', grantsPath: '/data/work-grants.json' })
  const on = getConfig({
    FRIDAY_WORK_READ_ENABLED: 'true', FRIDAY_WORK_READ_KEY: 'reader-jwt',
    FRIDAY_WORK_READ_GATEWAY_KEY: 'anon', FRIDAY_WORK_GRANTS_PATH: '/data/grants.json',
  }).work
  assert.deepEqual(on, { enabled: true, readKey: 'reader-jwt', gatewayKey: 'anon', grantsPath: '/data/grants.json' })
})

async function grantsFile(t, contents) {
  const root = await mkdtemp(join(tmpdir(), 'friday-grants-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'work-grants.json')
  await writeFile(path, JSON.stringify(contents))
  return path
}

const subject = 'access-subject-123'
const hashed = createHash('sha256').update(subject).digest('hex')

test('grants are looked up by the hashed Access subject and never store the raw subject', async (t) => {
  const path = await grantsFile(t, { [hashed]: { allowedProjectIds: ['app-builder'], allowedMemoryScopes: [] } })
  const grants = await createWorkGrants({ path })
  assert.deepEqual(await grants.forSubject(subject), { allowedProjectIds: ['app-builder'], allowedMemoryScopes: [] })
  await assert.rejects(grants.forSubject('someone-else'))
  assert.equal(grants.subjects(), 1)
})

test('a malformed or missing grants file grants nothing', async (t) => {
  for (const contents of [{ [hashed]: { allowedProjectIds: 'app-builder', allowedMemoryScopes: [] } }, { [hashed]: { allowedProjectIds: ['app-builder'] } }, { 'not-a-hash': { allowedProjectIds: [], allowedMemoryScopes: [] } }]) {
    const grants = await createWorkGrants({ path: await grantsFile(t, contents) })
    await assert.rejects(grants.forSubject(subject), JSON.stringify(contents))
  }
  const missing = await createWorkGrants({ path: join(tmpdir(), 'friday-grants-absent', 'none.json') })
  assert.equal(missing.subjects(), 0)
  await assert.rejects(missing.forSubject(subject))
})
