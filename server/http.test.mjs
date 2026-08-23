import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'

function baseConfig(monitoringEnabled = true) {
  return {
    mode: 'live',
    port: 3010,
    monitoring: { enabled: monitoringEnabled, statePath: '/tmp/unused.json' },
    ai: { enabled: false, apiKey: '', model: 'test-model' },
  }
}

function cachedOverview() {
  return {
    mode: 'live',
    generatedAt: '2026-08-19T00:00:00.000Z',
    sites: [], services: [{ id: 'svc', name: 'svc', host: 'VM 100', status: 'offline', detail: 'image', updated: 'Exited' }],
    alerts: [], resources: [], activities: [], integrations: [],
  }
}

function runtime(overrides = {}) {
  const incident = {
    id: 'i1', type: 'service-offline', title: 'Service offline', detail: 'svc is offline', severity: 'high',
    status: 'open', source: 'monitoring', host: 'VM 100', serviceId: 'svc', serviceName: 'svc',
    firstSeen: '2026-08-19T00:00:00.000Z', lastSeen: '2026-08-19T00:05:01.000Z', openedAt: '2026-08-19T00:05:01.000Z',
    resolvedAt: null, recommendedAction: 'Approval required before execution.', evidence: ['Exited'],
  }
  return {
    getOverview: () => cachedOverview(),
    getIncidents: () => ({ summary: { active: 1, high: 1, warning: 0, resolved: 0 }, incidents: [incident] }),
    getHistory: () => ({ events: [{ id: 'h1', type: 'incident-opened', at: '2026-08-19T00:05:01.000Z', source: 'monitoring', detail: 'HIGH Service offline' }] }),
    getSummary: () => ({ enabled: true, status: 'ok', lastPollAt: '2026-08-19T00:05:01.000Z', lastSuccessAt: '2026-08-19T00:05:01.000Z', lastError: null, activeIncidents: 1, openHigh: 1, openWarning: 0 }),
    ...overrides,
  }
}

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try {
    return await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

async function postAssistant(base, prompt = 'what is wrong?') {
  return fetch(`${base}/api/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
}

test('GET monitoring routes return runtime data', async () => {
  const monitoringRuntime = runtime()
  await withServer({ config: baseConfig(true), monitoringRuntime }, async (base) => {
    const incidentsResponse = await fetch(`${base}/api/incidents`)
    assert.equal(incidentsResponse.status, 200)
    const incidents = await incidentsResponse.json()
    assert.equal(incidents.summary.active, 1)
    assert.equal(incidents.incidents[0].id, 'i1')

    const historyResponse = await fetch(`${base}/api/monitoring/history`)
    assert.equal(historyResponse.status, 200)
    const history = await historyResponse.json()
    assert.equal(history.events[0].type, 'incident-opened')
  })
})

test('incident API exposes no write methods', async () => {
  await withServer({ config: baseConfig(true), monitoringRuntime: runtime() }, async (base) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}/api/incidents`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
      assert.equal(response.status, 404, `${method} must be unavailable`)
      assert.deepEqual(await response.json(), { error: 'not-found' })
    }
  })
})

test('overview uses cached monitoring data when monitoring is enabled', async () => {
  let directCalls = 0
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    buildOverviewImpl: async () => { directCalls += 1; return { mode: 'mock', services: [], alerts: [] } },
  }, async (base) => {
    const response = await fetch(`${base}/api/overview`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.mode, 'live')
    assert.equal(body.incidents[0].id, 'i1')
    assert.equal(body.monitoring.activeIncidents, 1)
    assert.ok(body.alerts.some((alert) => alert.id === 'incident-i1'))
    assert.equal(directCalls, 0)
  })
})

test('overview falls back to direct collection when monitoring is disabled or cache is empty', async () => {
  for (const [enabled, getOverview] of [[false, () => cachedOverview()], [true, () => null]]) {
    let directCalls = 0
    await withServer({
      config: baseConfig(enabled),
      monitoringRuntime: runtime({ getOverview }),
      buildOverviewImpl: async () => { directCalls += 1; return { mode: 'live', services: [], alerts: [], integrations: [] } },
    }, async (base) => {
      const response = await fetch(`${base}/api/overview`)
      assert.equal(response.status, 200)
      assert.equal(directCalls, 1)
      assert.equal((await response.json()).mode, 'live')
    })
  }
})

test('command preview route is preserved', async () => {
  await withServer({ config: baseConfig(false), monitoringRuntime: runtime() }, async (base) => {
    const response = await fetch(`${base}/api/commands/preview`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'show service status' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.accepted, true)
    assert.equal(body.destructive, false)
  })
})

test('assistant receives the same monitoring-aware overview as the UI', async () => {
  let seenOverview = null
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async ({ overview }) => { seenOverview = overview; return { available: true, text: 'advisory only' } },
  }, async (base) => {
    const uiOverview = await (await fetch(`${base}/api/overview`)).json()
    const response = await postAssistant(base)
    assert.equal(response.status, 200)
    assert.ok(seenOverview)
    assert.deepEqual(seenOverview.incidents, uiOverview.incidents)
    assert.deepEqual(seenOverview.monitoring, uiOverview.monitoring)
  })
})

test('assistant API returns 200 for an available cloud local or deterministic answer', async () => {
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async () => ({ available: true, mode: 'cloud-ai', provider: 'openai', model: 'model', text: 'answer', attempts: [] }),
  }, async (base) => {
    const response = await postAssistant(base)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).provider, 'openai')
  })
})

test('assistant API returns 400 for invalid prompt results', async () => {
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async () => ({ available: false, error: 'invalid-prompt', reason: 'A prompt is required.' }),
  }, async (base) => {
    const response = await postAssistant(base, '')
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' })
  })
})

test('assistant API returns 503 for exhausted provider chain', async () => {
  const exhausted = {
    available: false,
    mode: 'local-analysis',
    provider: 'deterministic',
    model: null,
    reason: 'No configured AI provider was available and the request did not map to a supported local analysis command.',
    fallbackUsed: true,
    attempts: [{ provider: 'openai', outcome: 'upstream' }],
  }
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async () => exhausted,
  }, async (base) => {
    const response = await postAssistant(base)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), exhausted)
  })
})

test('assistant API sanitizes unexpected server faults and returns 502', async () => {
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async () => { throw new Error('provider secret or internal network detail') },
  }, async (base) => {
    const response = await postAssistant(base)
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { available: false, error: 'assistant-failed' })
  })
})
