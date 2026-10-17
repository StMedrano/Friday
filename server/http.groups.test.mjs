import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { createFridayServer } from './http.mjs'

const access = { enabled: true, publicOrigin: 'https://friday.example' }
const viewer = async () => ({ ok: true, email: 'viewer@example.test', operator: false })
async function run(options, check) {
  let calls = 0
  const server = createFridayServer({
    agentRegistryService: { async list() { calls++; return [{ id: 'proxmox-observer', enabled: true, instructions: ['PRIVATE'], credentials: 'SECRET' }] } },
    ...options,
    config: { mode: 'live', ai: { enabled: false }, access, ...options.config },
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { await check(`http://127.0.0.1:${server.address().port}`, () => calls) }
  finally { server.close(); await once(server, 'close') }
}
test('anonymous viewer denied before registry read', async () => {
  await run({ verifyAccessImpl: async () => ({ ok: false, status: 401 }) }, async (base, calls) => {
    assert.equal((await fetch(base + '/api/agent-groups')).status, 401)
    assert.equal(calls(), 0)
  })
})
test('live Access unconfigured or disabled fails closed', async () => {
  for (const access of [{ enabled: true }, { enabled: false }, undefined]) {
    await run({ config: { access } }, async (base, calls) => {
      assert.equal((await fetch(base + '/api/agent-groups')).status, 503)
      assert.equal(calls(), 0)
      assert.equal((await fetch(base + '/api/health')).status, 200)
    })
  }
})
test('signed viewer reads only no-store display metadata', async () => {
  await run({ verifyAccessImpl: viewer }, async (base, calls) => {
    const response = await fetch(base + '/api/agent-groups')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.deepEqual(body.groups.map(g => g.id), ['techtactics', 'app-builder', 'homelab'])
    assert.equal(body.executionEnabled, false)
    assert.equal(body.workStatus, 'not-connected')
    assert.equal(body.groups[2].members.find(m => m.agentId === 'proxmox-observer').state, 'configured')
    assert.equal(JSON.stringify(body).includes('PRIVATE'), false)
    assert.equal(JSON.stringify(body).includes('SECRET'), false)
    assert.equal(calls(), 1)
  })
})
test('POST remains unsupported without reads or side effects', async () => {
  await run({ verifyAccessImpl: viewer }, async (base, calls) => {
    assert.equal((await fetch(base + '/api/agent-groups', { method: 'POST' })).status, 404)
    assert.equal(calls(), 0)
  })
})
test('malformed request URL remains rejected before reads', async () => {
  await run({ verifyAccessImpl: viewer }, async (base, calls) => {
    const status = await new Promise((resolve, reject) => {
      const req = request(base, { path: 'http://[invalid', method: 'GET' }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(status, 400)
    assert.equal(calls(), 0)
  })
})
test('registry outage preserves display catalog', async () => {
  await run({ verifyAccessImpl: viewer, agentRegistryService: { async list() { throw Error('private error') } } }, async base => {
    const response = await fetch(base + '/api/agent-groups')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.registryStatus, 'unavailable')
    assert.equal(body.groups.length, 3)
    assert.equal(body.groups[2].members.find(m => m.agentId).state, 'unavailable')
  })
})

test('mock mode can read display metadata without Access', async () => {
  await run({ config: { mode: 'mock', access: undefined }, agentRegistryService: null }, async base => {
    const response = await fetch(base + '/api/agent-groups')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.registryStatus, 'unavailable')
    assert.equal(body.executionEnabled, false)
  })
})
