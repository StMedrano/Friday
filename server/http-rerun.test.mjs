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

function runtime(calls) {
  return {
    getOverview: () => null,
    getIncidents: () => ({ summary: { active: 1, high: 1, warning: 0, resolved: 0 }, incidents: [] }),
    getHistory: () => ({ events: [] }),
    getSummary: () => ({ enabled: true, status: 'ok', activeIncidents: 1, openHigh: 1, openWarning: 0 }),
    getDiagnostic: () => ({ statusCode: 200, body: { incidentId: 'i1', status: 'available', facts: [] } }),
    getIncidentLogs: async () => ({ statusCode: 200, body: { incidentId: 'i1', logs: 'safe', tail: 100, truncated: false } }),
    rerunDiagnostic: async (id) => {
      calls.push(id)
      return id === 'i1'
        ? { statusCode: 200, body: { incidentId: 'i1', status: 'available', findings: ['fresh diagnosis'] } }
        : { statusCode: 404, body: { error: 'incident-not-found' } }
    },
  }
}

test('controller exposes exactly one POST read-only diagnostic rerun route', async () => {
  const calls = []
  await withServer(runtime(calls), async (base) => {
    const response = await fetch(`${base}/api/incidents/i1/diagnostics/rerun`, { method: 'POST' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).findings[0], 'fresh diagnosis')
    assert.deepEqual(calls, ['i1'])

    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const blocked = await fetch(`${base}/api/incidents/i1/diagnostics/rerun`, { method })
      assert.equal(blocked.status, 404, `${method} rerun must be unavailable`)
      assert.deepEqual(await blocked.json(), { error: 'not-found' })
    }

    const existingDiagnosticPost = await fetch(`${base}/api/incidents/i1/diagnostics`, { method: 'POST' })
    assert.equal(existingDiagnosticPost.status, 404)
    const logsPost = await fetch(`${base}/api/incidents/i1/logs`, { method: 'POST' })
    assert.equal(logsPost.status, 404)
  })
})

test('rerun route validates incident id and requires the runtime capability', async () => {
  let calls = 0
  const monitored = runtime([])
  monitored.rerunDiagnostic = async () => { calls += 1; return { statusCode: 200, body: {} } }
  await withServer(monitored, async (base) => {
    const tooLong = await fetch(`${base}/api/incidents/${'a'.repeat(257)}/diagnostics/rerun`, { method: 'POST' })
    assert.equal(tooLong.status, 400)
    assert.deepEqual(await tooLong.json(), { error: 'invalid-incident-id' })
    assert.equal(calls, 0)
  })

  await withServer({
    getOverview: () => null,
    getIncidents: () => ({ summary: { active: 0, high: 0, warning: 0, resolved: 0 }, incidents: [] }),
    getHistory: () => ({ events: [] }),
    getSummary: () => ({ enabled: true, status: 'ok', activeIncidents: 0, openHigh: 0, openWarning: 0 }),
  }, async (base) => {
    const unavailable = await fetch(`${base}/api/incidents/i1/diagnostics/rerun`, { method: 'POST' })
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { error: 'diagnostics-unavailable' })
  })
})
