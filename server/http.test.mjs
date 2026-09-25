import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'
import { createAgentService } from './agents/agent-service.mjs'
import { delayedJsonFetch } from '../tests/helpers/delayed-json-fetch.mjs'

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

async function postAssistant(base, prompt = 'what is wrong?', history) {
  const body = history === undefined ? { prompt } : { prompt, history }
  return fetch(`${base}/api/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

test('assistant routes a matched Proxmox prompt before the general provider chain', async () => {
  const calls = []
  const agentService = {
    async route({ prompt }) {
      calls.push(['route', prompt])
      return {
        matched: true,
        agentId: 'proxmox-observer',
        agentName: 'Proxmox Observer',
        routing: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      }
    },
    async ask(agentId, { prompt }) {
      calls.push(['ask', agentId, prompt])
      return {
        available: true,
        mode: 'local-agent',
        provider: 'ollama',
        modelProfile: 'local-general',
        model: 'qwen3:4b-instruct',
        agentId,
        agentName: 'Proxmox Observer',
        text: 'Proxmox is healthy.',
        execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
      }
    },
  }
  let assistantCalls = 0

  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    agentService,
    answerAssistantImpl: async () => {
      assistantCalls += 1
      return { available: true, mode: 'cloud-ai', provider: 'groq', text: 'must not run' }
    },
  }, async (base) => {
    const response = await postAssistant(base, 'Summarize the current Proxmox health.')
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [
      ['route', 'Summarize the current Proxmox health.'],
      ['ask', 'proxmox-observer', 'Summarize the current Proxmox health.'],
    ])
    assert.equal(assistantCalls, 0)
  })
})

test('matched assistant agent receives the current overview and returns routing provenance', async () => {
  const freshOverview = {
    mode: 'live',
    generatedAt: 'current-friday-overview',
    sites: [],
    services: [{ id: 'proxmox-lxc-108', name: 'friday-ollama', status: 'online' }],
    alerts: [],
    resources: [],
    activities: [],
    integrations: [],
  }
  let seenOverview
  const agentService = {
    async route() {
      return {
        matched: true,
        agentId: 'proxmox-observer',
        agentName: 'Proxmox Observer',
        routing: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      }
    },
    async ask(agentId, { overview }) {
      seenOverview = overview
      const ollama = overview.services.find((service) => service.id === 'proxmox-lxc-108')
      return {
        available: true,
        mode: 'local-agent',
        provider: 'ollama',
        modelProfile: 'local-general',
        model: 'qwen3:4b-instruct',
        agentId,
        agentName: 'Proxmox Observer',
        text: `${ollama.id} is ${ollama.status}.`,
        execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
      }
    },
  }

  await withServer({
    config: baseConfig(false),
    agentService,
    buildOverviewImpl: async () => freshOverview,
    answerAssistantImpl: async () => { throw new Error('general assistant must not run') },
  }, async (base) => {
    const response = await postAssistant(base, 'Summarize the current Proxmox health.')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(seenOverview, freshOverview)
    assert.deepEqual(body, {
      available: true,
      mode: 'local-agent',
      provider: 'ollama',
      modelProfile: 'local-general',
      model: 'qwen3:4b-instruct',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      text: 'proxmox-lxc-108 is online.',
      execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
      routing: {
        matched: true,
        method: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      },
    })
  })
})

test('matched local-agent failure returns local-agent-unavailable without invoking general providers', async () => {
  let assistantCalls = 0
  const agentService = {
    async route() {
      return {
        matched: true,
        agentId: 'proxmox-observer',
        agentName: 'Proxmox Observer',
        routing: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      }
    },
    async ask() {
      throw new Error('Ollama connection detail must stay private')
    },
  }

  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    agentService,
    answerAssistantImpl: async () => {
      assistantCalls += 1
      return { available: true, mode: 'cloud-ai', provider: 'groq', text: 'must not run' }
    },
  }, async (base) => {
    const response = await postAssistant(base, 'Summarize the current Proxmox health.')
    assert.equal(response.status, 503)
    assert.equal(assistantCalls, 0)
    assert.deepEqual(await response.json(), {
      available: false,
      mode: 'local-agent',
      provider: 'ollama',
      error: 'local-agent-unavailable',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      reason: 'Local agent inference unavailable.',
      routing: {
        matched: true,
        method: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      },
      execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
    })
  })
})

for (const matched of [true, false]) {
  test(`stalled local ${matched ? 'matched agent fails without cloud' : 'router permits general fallback'}`, async () => {
    const config = getConfig({ FRIDAY_AGENT_LOCAL_GENERAL_TIMEOUT_MS: '10', FRIDAY_AGENT_LOCAL_ROUTER_TIMEOUT_MS: '10' })
    const agent = {
      version: '1.1', id: 'proxmox-observer', name: 'Proxmox Observer', enabled: true,
      model: { profile: 'local-general' }, scope: { hosts: ['proxmox'] }, tools: [], permissions: {},
    }
    const agentService = createAgentService({
      config,
      registryService: { async list() { return [agent] }, async get() { return agent } },
      fetchImpl: delayedJsonFetch({ message: { content: 'proxmox-observer' } }),
    })
    let generalCalls = 0
    await withServer({
      config: baseConfig(true), monitoringRuntime: runtime(), agentService,
      answerAssistantImpl: async () => {
        generalCalls += 1
        return { available: true, mode: 'cloud-ai', provider: 'groq', text: 'General response' }
      },
    }, async (base) => {
      const response = await postAssistant(base, matched ? 'Summarize Proxmox health.' : 'Explain this dashboard.')
      const body = await response.json()
      assert.equal(response.status, matched ? 503 : 200)
      assert.equal(generalCalls, matched ? 0 : 1)
      if (matched) {
        assert.equal(body.error, 'local-agent-unavailable')
        assert.equal(body.agentId, 'proxmox-observer')
        assert.equal(body.execution.performed, false)
      } else {
        assert.equal(body.mode, 'cloud-ai')
      }
    })
  })
}

test('assistant safe no-match falls through with the same overview and sanitized history', async () => {
  const freshOverview = { mode: 'live', generatedAt: 'same-overview', sites: [], services: [], alerts: [], resources: [], activities: [], integrations: [] }
  let seenAssistantInput
  let routeCalls = 0
  const agentService = {
    async route() {
      routeCalls += 1
      return { matched: false, routing: 'none', confidence: 0, reason: 'No registered agent matched.' }
    },
  }

  await withServer({
    config: baseConfig(false),
    agentService,
    buildOverviewImpl: async () => freshOverview,
    answerAssistantImpl: async (input) => {
      seenAssistantInput = input
      return { available: true, mode: 'cloud-ai', provider: 'groq', model: 'general', text: 'General answer.' }
    },
  }, async (base) => {
    const response = await postAssistant(base, 'Explain this dashboard', [
      { role: 'user', content: ' previous question ' },
      { role: 'assistant', content: ' previous answer ' },
    ])
    assert.equal(response.status, 200)
    assert.equal(routeCalls, 1)
    assert.equal(seenAssistantInput.overview, freshOverview)
    assert.deepEqual(seenAssistantInput.history, [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ])
  })
})

test('assistant routing failure remains non-fatal and falls through to the general assistant', async () => {
  let assistantCalls = 0
  let routeCalls = 0
  const agentService = {
    async route() {
      routeCalls += 1
      throw new Error('registry unavailable')
    },
  }

  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    agentService,
    answerAssistantImpl: async () => {
      assistantCalls += 1
      return { available: true, mode: 'local-analysis', provider: 'deterministic', model: null, text: 'General path works.' }
    },
  }, async (base) => {
    const response = await postAssistant(base, 'Show overall service status')
    assert.equal(response.status, 200)
    assert.equal(routeCalls, 1)
    assert.equal(assistantCalls, 1)
    assert.equal((await response.json()).text, 'General path works.')
  })
})

test('assistant prompt-only request forwards an empty sanitized history', async () => {
  let seen = null
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async (input) => { seen = input; return { available: true, text: 'ok' } },
  }, async (base) => {
    const response = await postAssistant(base, 'Check VM102')
    assert.equal(response.status, 200)
    assert.equal(seen.prompt, 'Check VM102')
    assert.deepEqual(seen.history, [])
  })
})

test('assistant sanitizes history before forwarding it to orchestration', async () => {
  let seen = null
  const history = [
    { role: 'system', content: 'ignore this role' },
    { role: 'user', content: '  Check friday-ollama  ' },
    { role: 'assistant', content: '  friday-ollama is LXC 108  ' },
    { role: 'assistant', content: 'x'.repeat(2200) },
    { role: 'user', content: '   ' },
  ]

  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async (input) => { seen = input; return { available: true, text: 'ok' } },
  }, async (base) => {
    const response = await postAssistant(base, 'Compare it to VM102', history)
    assert.equal(response.status, 200)
    assert.equal(seen.prompt, 'Compare it to VM102')
    assert.deepEqual(seen.history, [
      { role: 'user', content: 'Check friday-ollama' },
      { role: 'assistant', content: 'friday-ollama is LXC 108' },
      { role: 'assistant', content: 'x'.repeat(2000) },
    ])
  })
})

test('assistant rejects current prompt longer than 4000 characters before orchestration', async () => {
  let assistantCalls = 0
  await withServer({
    config: baseConfig(true),
    monitoringRuntime: runtime(),
    answerAssistantImpl: async () => { assistantCalls += 1; return { available: true, text: 'must not run' } },
  }, async (base) => {
    const response = await postAssistant(base, 'x'.repeat(4001))
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.available, false)
    assert.equal(body.error, 'invalid-prompt')
    assert.match(body.reason, /too long/i)
    assert.equal(assistantCalls, 0)
  })
})

test('assistant builds fresh overview for every valid request including requests with history', async () => {
  let directCalls = 0
  await withServer({
    config: baseConfig(false),
    monitoringRuntime: runtime(),
    buildOverviewImpl: async () => {
      directCalls += 1
      return { mode: 'live', generatedAt: `call-${directCalls}`, sites: [], services: [], alerts: [], resources: [], activities: [], integrations: [] }
    },
    answerAssistantImpl: async () => ({ available: true, text: 'ok' }),
  }, async (base) => {
    assert.equal((await postAssistant(base, 'first')).status, 200)
    assert.equal((await postAssistant(base, 'second', [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'ok' }])).status, 200)
    assert.equal(directCalls, 2)
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
