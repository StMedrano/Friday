import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState } from './state.mjs'
import { createMonitoringRuntime } from './runtime.mjs'

const serviceId = 'vm100-observer-abcdef123456'

function config(diagnosticsEnabled = true) {
  return {
    monitoring: { enabled: true, pollSeconds: 30, offlineGraceSeconds: 0, historyLimit: 50, statePath: '/tmp/unused.json' },
    diagnostics: { enabled: diagnosticsEnabled },
    vm100Observer: { enabled: true, baseUrl: 'http://192.168.1.124:3199', token: 'observer-secret', hostName: 'VM 100' },
  }
}

function overview() {
  return {
    mode: 'live',
    services: [
      { id: serviceId, name: 'nginx-proxy-manager', host: 'VM 100', status: 'offline', detail: 'image', updated: 'Exited (255)' },
      { id: 'vm100-observer-111111111111', name: 'healthy-one', host: 'VM 100', status: 'online', detail: 'image', updated: 'Up' },
      { id: 'vm100-observer-222222222222', name: 'healthy-two', host: 'VM 100', status: 'online', detail: 'image', updated: 'Up' },
    ],
    alerts: [], integrations: [], sites: [], resources: [], activities: [],
  }
}

function incident(overrides = {}) {
  return {
    id: 'i1', fingerprint: `service-offline:${serviceId}`, type: 'service-offline', title: 'Service offline',
    detail: 'nginx-proxy-manager is offline', severity: 'high', status: 'open', source: 'monitoring', host: 'VM 100',
    serviceId, serviceName: 'nginx-proxy-manager', firstSeen: '2026-08-20T00:00:00.000Z', lastSeen: '2026-08-20T00:05:00.000Z',
    openedAt: '2026-08-20T00:05:00.000Z', resolvedAt: null, recommendedAction: 'Inspect only', evidence: ['Exited (255)'],
    ...overrides,
  }
}

function stateWithIncident(value = incident()) {
  const state = createEmptyMonitoringState()
  state.incidents.push(value)
  state.observations[serviceId] = {
    serviceId, serviceName: 'nginx-proxy-manager', host: 'VM 100', status: 'offline',
    firstObservedAt: '2026-08-20T00:00:00.000Z', lastObservedAt: '2026-08-20T00:05:00.000Z', statusChangedAt: '2026-08-20T00:00:00.000Z',
    consecutive: 2, transitions: [],
  }
  if (value.serviceId === serviceId) {
    state.diagnostics[value.id] = {
      id: `diagnostic-${value.id}`, incidentId: value.id, source: 'vm100-observer', host: 'VM 100', serviceId,
      serviceName: 'nginx-proxy-manager', collectedAt: '2026-08-20T00:10:00.000Z', status: 'available', metadata: { exitCode: 255 },
      facts: [], findings: [], likelyCauses: [], recommendations: [], logsAvailable: true, lastLogInspectionAt: null, error: null,
    }
  }
  return state
}

function store(initial) {
  const saved = []
  return {
    saved,
    async load() { return structuredClone(initial) },
    async save(state) { saved.push(structuredClone(state)) },
  }
}

async function startedRuntime({ diagnosticsEnabled = true, initial = stateWithIncident(), fetchLogsImpl } = {}) {
  const memory = store(initial)
  const runtime = createMonitoringRuntime({
    config: config(diagnosticsEnabled),
    collectOverview: async () => overview(),
    collectDiagnosticImpl: async () => { throw new Error('must not recollect existing diagnostic') },
    fetchLogsImpl,
    store: memory,
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  return { runtime, memory }
}

test('unknown incident log request returns 404 without calling observer', async () => {
  let calls = 0
  const { runtime } = await startedRuntime({ fetchLogsImpl: async () => { calls += 1; return {} } })
  assert.deepEqual(await runtime.getIncidentLogs('missing'), { statusCode: 404, body: { error: 'incident-not-found' } })
  assert.equal(calls, 0)
})

test('diagnostics disabled rejects log inspection without provider access', async () => {
  let calls = 0
  const { runtime } = await startedRuntime({ diagnosticsEnabled: false, fetchLogsImpl: async () => { calls += 1; return {} } })
  assert.deepEqual(await runtime.getIncidentLogs('i1'), { statusCode: 409, body: { error: 'diagnostics-disabled' } })
  assert.equal(calls, 0)
})

test('unsupported incident rejects logs without provider access', async () => {
  const unsupported = incident({ id: 'integration-1', type: 'integration-unavailable', serviceId: undefined })
  let calls = 0
  const { runtime } = await startedRuntime({ initial: stateWithIncident(unsupported), fetchLogsImpl: async () => { calls += 1; return {} } })
  assert.deepEqual(await runtime.getIncidentLogs('integration-1'), { statusCode: 409, body: { error: 'diagnostics-not-supported' } })
  assert.equal(calls, 0)
})

test('explicit log inspection fetches exactly 100 lines and persists metadata only', async () => {
  let seen
  const rawLogs = 'safe application log\nsecond line'
  const { runtime, memory } = await startedRuntime({
    fetchLogsImpl: async (observerConfig, containerId, tail) => {
      seen = { observerConfig, containerId, tail }
      return { logs: rawLogs, tail: 100, truncated: false, observedAt: '2026-08-20T00:59:59.000Z' }
    },
  })

  const result = await runtime.getIncidentLogs('i1')
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.logs, rawLogs)
  assert.equal(result.body.tail, 100)
  assert.equal(result.body.truncated, false)
  assert.equal(seen.containerId, 'abcdef123456')
  assert.equal(seen.tail, 100)
  assert.equal(seen.observerConfig.baseUrl, 'http://192.168.1.124:3199')
  assert.equal(runtime.getIncidents().incidents[0].status, 'open')
  assert.equal(runtime.getDiagnostic('i1').body.lastLogInspectionAt, '2026-08-20T01:00:00.000Z')
  assert.ok(runtime.getHistory().events.some((event) => event.type === 'diagnostic-logs-inspected'))

  const persisted = JSON.stringify(memory.saved.at(-1))
  assert.equal(persisted.includes(rawLogs), false)
  assert.equal(persisted.includes('safe application log'), false)
})

test('observer log failure is sanitized, audited, non-mutating, and never persists raw logs', async () => {
  const { runtime, memory } = await startedRuntime({
    fetchLogsImpl: async () => { throw new Error('observer token=supersecret failed while reading logs') },
  })
  const result = await runtime.getIncidentLogs('i1')
  assert.deepEqual(result, { statusCode: 502, body: { error: 'diagnostic-logs-unavailable' } })
  assert.equal(runtime.getIncidents().incidents[0].status, 'open')
  const event = runtime.getHistory().events.find((item) => item.type === 'diagnostic-logs-failed')
  assert.ok(event)
  assert.equal(event.detail.includes('supersecret'), false)
  const persisted = JSON.stringify(memory.saved.at(-1))
  assert.equal(persisted.includes('supersecret'), false)
})
