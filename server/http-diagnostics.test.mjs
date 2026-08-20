import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'

function config() {
  return {
    mode: 'live', port: 3010,
    monitoring: { enabled: true, statePath: '/tmp/unused.json' },
    diagnostics: { enabled: true },
    ai: { enabled: false, apiKey: '', model: 'test-model' },
  }
}

async function withServer(monitoringRuntime, fn) {
  const server = createFridayServer({ config: config(), monitoringRuntime, buildOverviewImpl: async () => ({ mode: 'live', services: [], alerts: [] }) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

function runtime() {
  return {
    getOverview: () => null,
    getIncidents: () => ({ summary: { active: 1, high: 1, warning: 0, resolved: 0 }, incidents: [] }),
    getHistory: () => ({ events: [] }),
    getSummary: () => ({ enabled: true, status: 'ok', activeIncidents: 1, openHigh: 1, openWarning: 0 }),
    getDiagnostic: (id) => id === 'i1'
      ? { statusCode: 200, body: { incidentId: 'i1', status: 'available', facts: [] } }
      : { statusCode: 404, body: { error: 'incident-not-found' } },
    getIncidentLogs: async (id) => id === 'i1'
      ? { statusCode: 200, body: { incidentId: 'i1', logs: 'safe', tail: 100, truncated: false } }
      : { statusCode: 404, body: { error: 'incident-not-found' } },
  }
}

test('controller exposes incident-scoped GET diagnostics and logs', async () => {
  await withServer(runtime(), async (base) => {
    const diagnostics = await fetch(`${base}/api/incidents/i1/diagnostics`)
    assert.equal(diagnostics.status, 200)
    assert.equal((await diagnostics.json()).status, 'available')

    const logs = await fetch(`${base}/api/incidents/i1/logs`)
    assert.equal(logs.status, 200)
    assert.equal((await logs.json()).logs, 'safe')

    const missing = await fetch(`${base}/api/incidents/missing/diagnostics`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'incident-not-found' })
  })
})

test('diagnostic controller routes expose no write methods', async () => {
  await withServer(runtime(), async (base) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const suffix of ['diagnostics', 'logs']) {
        const response = await fetch(`${base}/api/incidents/i1/${suffix}`, { method })
        assert.equal(response.status, 404, `${method} ${suffix} must be unavailable`)
        assert.deepEqual(await response.json(), { error: 'not-found' })
      }
    }
  })
})

test('controller returns 503 when diagnostics runtime methods are unavailable', async () => {
  await withServer({
    getOverview: () => null,
    getIncidents: () => ({ summary: { active: 0, high: 0, warning: 0, resolved: 0 }, incidents: [] }),
    getHistory: () => ({ events: [] }),
    getSummary: () => ({ enabled: true, status: 'ok', activeIncidents: 0, openHigh: 0, openWarning: 0 }),
  }, async (base) => {
    for (const suffix of ['diagnostics', 'logs']) {
      const response = await fetch(`${base}/api/incidents/i1/${suffix}`)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'diagnostics-unavailable' })
    }
  })
})

test('controller rejects overlong and malformed encoded incident ids before runtime access', async () => {
  let calls = 0
  const monitored = { ...runtime(), getDiagnostic: () => { calls += 1; return { statusCode: 200, body: {} } } }
  await withServer(monitored, async (base) => {
    const tooLong = await fetch(`${base}/api/incidents/${'a'.repeat(257)}/diagnostics`)
    assert.equal(tooLong.status, 400)
    assert.deepEqual(await tooLong.json(), { error: 'invalid-incident-id' })

    const malformed = await fetch(`${base}/api/incidents/%E0%A4%A/diagnostics`)
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: 'invalid-incident-id' })
    assert.equal(calls, 0)
  })
})
