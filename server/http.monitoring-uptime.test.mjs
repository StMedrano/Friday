import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'

const baseConfig = getConfig({ FRIDAY_MODE: 'live' })
const projected = { generatedAt: '2026-11-05T10:00:00.000Z', windowHours: 168, services: [
  { serviceId: 'svc', name: 'svc', last24h: { uptime: 50, checks: 2, degraded: 0, offline: 1 }, last7d: { uptime: 50, checks: 2, degraded: 0, offline: 1 },
    hourly: [{ at: '2026-11-05T10:00:00.000Z', online: 1, degraded: 0, offline: 1, maintenance: 0 }] },
] }

async function run({ monitoring = {}, runtime = null }, check) {
  const server = createFridayServer({
    config: { ...baseConfig, monitoring: { ...baseConfig.monitoring, enabled: true, uptimeEnabled: true, ...monitoring } },
    monitoringRuntime: runtime,
    accessGateImpl: async () => ({ status: 200, identity: { subject: 'reader', email: 'reader@example.test' } }),
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { await check(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise((resolve) => server.close(resolve)) }
}

test('uptime is explicit when monitoring or the uptime record is off, and never an empty success', async () => {
  let reads = 0
  const runtime = { getUptime() { reads += 1; return projected } }
  for (const [monitoring, error] of [[{ enabled: false }, 'monitoring-disabled'], [{ uptimeEnabled: false }, 'uptime-disabled']]) {
    await run({ monitoring, runtime }, async (base) => {
      const response = await fetch(`${base}/api/monitoring/uptime`)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error })
    })
  }
  assert.equal(reads, 0)
  for (const missing of [null, {}, { getUptime: () => null }, { getUptime: () => { throw new Error('x') } }]) {
    await run({ runtime: missing }, async (base) => {
      const response = await fetch(`${base}/api/monitoring/uptime`)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'uptime-unavailable' })
    })
  }
})

test('uptime returns the projected record read only', async () => {
  await run({ runtime: { getUptime: () => projected } }, async (base) => {
    const response = await fetch(`${base}/api/monitoring/uptime`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), projected)
    assert.equal((await fetch(`${base}/api/monitoring/uptime?x=1`)).status, 400)
    assert.equal((await fetch(`${base}/api/monitoring/uptime`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404)
  })
})
