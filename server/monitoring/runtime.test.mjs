import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState } from './state.mjs'
import { createMonitoringRuntime } from './runtime.mjs'

const diagnosticServiceId = 'vm100-observer-abcdef123456'

function config(enabled = true, diagnosticsEnabled = false) {
  return {
    monitoring: {
      enabled,
      pollSeconds: 30,
      offlineGraceSeconds: 0,
      historyLimit: 50,
      statePath: '/tmp/unused.json',
    },
    diagnostics: { enabled: diagnosticsEnabled },
    vm100Observer: {
      enabled: true,
      baseUrl: 'http://192.168.1.124:3199',
      token: 'observer-secret',
      hostName: 'VM 100',
    },
  }
}

function overview(status = 'online') {
  return {
    mode: 'live',
    services: [{ id: 'svc', name: 'svc', host: 'VM 100', status, detail: 'image', updated: status }],
    alerts: [], integrations: [], sites: [], resources: [], activities: [],
  }
}

function diagnosticOverview(status = 'offline') {
  return {
    mode: 'live',
    services: [
      { id: diagnosticServiceId, name: 'nginx-proxy-manager', host: 'VM 100', status, detail: 'jc21/nginx-proxy-manager:latest', updated: status === 'offline' ? 'Exited (255)' : 'Up' },
      { id: 'vm100-observer-111111111111', name: 'healthy-one', host: 'VM 100', status: 'online', detail: 'healthy:latest', updated: 'Up' },
      { id: 'vm100-observer-222222222222', name: 'healthy-two', host: 'VM 100', status: 'online', detail: 'healthy:latest', updated: 'Up' },
    ],
    alerts: [], integrations: [], sites: [], resources: [], activities: [],
  }
}

function openIncident(overrides = {}) {
  return {
    id: 'npm-offline-1',
    fingerprint: `service-offline:${diagnosticServiceId}`,
    type: 'service-offline',
    title: 'Service offline',
    detail: 'nginx-proxy-manager is offline on VM 100',
    severity: 'high',
    status: 'open',
    source: 'monitoring',
    host: 'VM 100',
    serviceId: diagnosticServiceId,
    serviceName: 'nginx-proxy-manager',
    firstSeen: '2026-08-20T00:00:00.000Z',
    lastSeen: '2026-08-20T00:05:00.000Z',
    openedAt: '2026-08-20T00:05:00.000Z',
    resolvedAt: null,
    recommendedAction: 'Inspect only.',
    evidence: ['Exited (255)'],
    ...overrides,
  }
}

function stateWithOpenIncident() {
  const state = createEmptyMonitoringState()
  state.observations[diagnosticServiceId] = {
    serviceId: diagnosticServiceId,
    serviceName: 'nginx-proxy-manager',
    host: 'VM 100',
    status: 'offline',
    firstObservedAt: '2026-08-20T00:00:00.000Z',
    lastObservedAt: '2026-08-20T00:05:00.000Z',
    statusChangedAt: '2026-08-20T00:00:00.000Z',
    consecutive: 2,
    transitions: [],
  }
  state.incidents.push(openIncident())
  return state
}

function memoryStore(initial = createEmptyMonitoringState()) {
  const saved = []
  return {
    saved,
    async load() { return structuredClone(initial) },
    async save(state) { saved.push(structuredClone(state)) },
  }
}

function availableDiagnostic(incident) {
  return {
    id: `diagnostic-${incident.id}`,
    incidentId: incident.id,
    source: 'vm100-observer',
    host: incident.host,
    serviceId: incident.serviceId,
    serviceName: incident.serviceName,
    collectedAt: '2026-08-20T01:00:00.000Z',
    status: 'available',
    metadata: { state: 'exited', exitCode: 255 },
    facts: [{ id: 'exit-code', label: 'Exit code', value: '255' }],
    findings: ['application failure'],
    likelyCauses: [],
    recommendations: ['inspect logs'],
    logsAvailable: true,
    lastLogInspectionAt: null,
    error: null,
  }
}

test('disabled runtime is inert', async () => {
  let collects = 0, loads = 0, saves = 0, timers = 0
  const runtime = createMonitoringRuntime({
    config: config(false),
    collectOverview: async () => { collects += 1; return overview() },
    store: { async load() { loads += 1; return createEmptyMonitoringState() }, async save() { saves += 1 } },
    setIntervalImpl() { timers += 1; return 1 },
  })
  await runtime.start()
  await runtime.poll()
  assert.deepEqual({ collects, loads, saves, timers }, { collects: 0, loads: 0, saves: 0, timers: 0 })
  assert.equal(runtime.getSummary().status, 'disabled')
})

test('enabled start loads state, polls immediately, then schedules interval', async () => {
  const calls = []
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => { calls.push('collect'); return overview() },
    store: { async load() { calls.push('load'); return createEmptyMonitoringState() }, async save() { calls.push('save') } },
    setIntervalImpl(fn, ms) { calls.push(`timer:${ms}`); return { fn } },
  })
  await runtime.start()
  assert.deepEqual(calls, ['load', 'collect', 'save', 'timer:30000'])
  assert.equal(runtime.getOverview().services[0].name, 'svc')
  assert.equal(runtime.getSummary().status, 'ok')
})

test('concurrent polls share one collector invocation', async () => {
  let collectCount = 0
  let release
  const wait = new Promise((resolve) => { release = resolve })
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => { collectCount += 1; await wait; return overview() },
    store: { async load() { return createEmptyMonitoringState() }, async save() {} },
  })
  const first = runtime.poll()
  const second = runtime.poll()
  assert.equal(first, second)
  assert.equal(collectCount, 1)
  release()
  await first
})

test('successful poll persists evaluated state and exposes incident ordering', async () => {
  let saved
  let tick = 0
  const times = ['2026-08-19T00:00:00.000Z', '2026-08-19T00:00:01.000Z']
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => overview('offline'),
    store: { async load() { return createEmptyMonitoringState() }, async save(state) { saved = structuredClone(state) } },
    now: () => new Date(times[Math.min(tick++, times.length - 1)]),
  })
  await runtime.poll()
  assert.ok(saved)
  assert.equal(runtime.getIncidents().incidents[0].type, 'service-offline')
  assert.equal(runtime.getIncidents().summary.active, 1)
})

test('collection failure retains cached overview, records history, and degrades summary', async () => {
  let fail = false
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => { if (fail) throw new Error('observer token=supersecret unavailable'); return overview() },
    store: { async load() { return createEmptyMonitoringState() }, async save() {} },
    now: () => new Date('2026-08-19T01:00:00.000Z'),
  })
  await runtime.poll()
  const cached = runtime.getOverview()
  fail = true
  await runtime.poll()
  assert.equal(runtime.getOverview(), cached)
  assert.equal(runtime.getSummary().status, 'degraded')
  assert.equal(runtime.getSummary().lastError.includes('supersecret'), false)
  assert.ok(runtime.getHistory().events.some((event) => event.type === 'monitoring-poll-failed'))
})

test('persistence failure keeps in-memory state and successful overview', async () => {
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => overview('offline'),
    store: { async load() { return createEmptyMonitoringState() }, async save() { throw new Error('disk full') } },
    now: () => new Date('2026-08-19T02:00:00.000Z'),
  })
  await runtime.poll()
  assert.equal(runtime.getOverview().services[0].status, 'offline')
  assert.equal(runtime.getIncidents().incidents.length, 1)
  assert.equal(runtime.getSummary().status, 'degraded')
  assert.match(runtime.getSummary().lastError, /disk full/)
})

test('history API is newest-first without changing stored chronological order', async () => {
  const prior = createEmptyMonitoringState()
  prior.history = [
    { id: '1', type: 'a', at: '2026-08-19T00:00:00.000Z' },
    { id: '2', type: 'b', at: '2026-08-19T00:01:00.000Z' },
  ]
  const runtime = createMonitoringRuntime({
    config: config(true),
    collectOverview: async () => overview(),
    store: { async load() { return prior }, async save() {} },
    setIntervalImpl() { return 1 },
  })
  await runtime.start()
  assert.deepEqual(runtime.getHistory().events.slice(-2).map((event) => event.id), ['2', '1'])
})

test('diagnostics disabled never calls observer diagnostics for an existing supported incident', async () => {
  let calls = 0
  const runtime = createMonitoringRuntime({
    config: config(true, false),
    collectOverview: async () => diagnosticOverview('offline'),
    collectDiagnosticImpl: async () => { calls += 1; return {} },
    store: memoryStore(stateWithOpenIncident()),
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  assert.equal(calls, 0)
  assert.deepEqual(runtime.getDiagnostic('npm-offline-1'), {
    statusCode: 200,
    body: { incidentId: 'npm-offline-1', status: 'not-supported', reason: 'diagnostics-disabled' },
  })
})

test('startup backfills one diagnostic for an existing supported incident and does not repeat every poll', async () => {
  let calls = 0
  const store = memoryStore(stateWithOpenIncident())
  const runtime = createMonitoringRuntime({
    config: config(true, true),
    collectOverview: async () => diagnosticOverview('offline'),
    collectDiagnosticImpl: async ({ incident, containerId, overview: seenOverview }) => {
      calls += 1
      assert.equal(containerId, 'abcdef123456')
      assert.equal(seenOverview.services.length, 3)
      return availableDiagnostic(incident)
    },
    store,
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  await runtime.poll()
  assert.equal(calls, 1)
  assert.equal(runtime.getDiagnostic('npm-offline-1').body.status, 'available')
  assert.equal(store.saved.at(-1).diagnostics['npm-offline-1'].status, 'available')
})

test('diagnostic reports survive later monitoring evaluations', async () => {
  const prior = stateWithOpenIncident()
  prior.diagnostics['npm-offline-1'] = availableDiagnostic(prior.incidents[0])
  const runtime = createMonitoringRuntime({
    config: config(true, true),
    collectOverview: async () => diagnosticOverview('offline'),
    collectDiagnosticImpl: async () => { throw new Error('must not recollect') },
    store: memoryStore(prior),
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  await runtime.poll()
  assert.equal(runtime.getDiagnostic('npm-offline-1').body.metadata.exitCode, 255)
})

test('unsupported incidents never call observer diagnostics and return not-supported', async () => {
  const state = createEmptyMonitoringState()
  state.incidents.push(openIncident({
    id: 'integration-1',
    fingerprint: 'integration-unavailable:vm100-observer',
    type: 'integration-unavailable',
    source: 'vm100-observer',
    serviceId: undefined,
  }))
  let calls = 0
  const runtime = createMonitoringRuntime({
    config: config(true, true),
    collectOverview: async () => overview('online'),
    collectDiagnosticImpl: async () => { calls += 1; return {} },
    store: memoryStore(state),
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  assert.equal(calls, 0)
  assert.deepEqual(runtime.getDiagnostic('integration-1'), {
    statusCode: 200,
    body: { incidentId: 'integration-1', status: 'not-supported', reason: 'incident-not-supported' },
  })
})

test('diagnostic collection failure stores unavailable sanitized report without failing monitoring', async () => {
  const store = memoryStore(stateWithOpenIncident())
  const runtime = createMonitoringRuntime({
    config: config(true, true),
    collectOverview: async () => diagnosticOverview('offline'),
    collectDiagnosticImpl: async () => { throw new Error('observer token=supersecret unavailable') },
    store,
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  const report = runtime.getDiagnostic('npm-offline-1').body
  assert.equal(report.status, 'unavailable')
  assert.equal(report.error.includes('supersecret'), false)
  assert.equal(runtime.getSummary().status, 'ok')
  assert.equal(runtime.getIncidents().incidents[0].status, 'open')
})

test('a resolved incident diagnostic remains while a later recurrence receives a new report', async () => {
  const state = createEmptyMonitoringState()
  const old = openIncident({ id: 'old-incident', status: 'resolved', resolvedAt: '2026-08-20T00:30:00.000Z' })
  state.incidents.push(old)
  state.diagnostics[old.id] = availableDiagnostic(old)
  state.observations[diagnosticServiceId] = {
    serviceId: diagnosticServiceId,
    serviceName: 'nginx-proxy-manager',
    host: 'VM 100',
    status: 'online',
    firstObservedAt: '2026-08-20T00:00:00.000Z',
    lastObservedAt: '2026-08-20T00:30:00.000Z',
    statusChangedAt: '2026-08-20T00:30:00.000Z',
    consecutive: 2,
    transitions: [],
  }
  let calls = 0
  const runtime = createMonitoringRuntime({
    config: config(true, true),
    collectOverview: async () => diagnosticOverview('offline'),
    collectDiagnosticImpl: async ({ incident }) => { calls += 1; return availableDiagnostic(incident) },
    store: memoryStore(state),
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T01:00:00.000Z'),
  })
  await runtime.start()
  const incidents = runtime.getIncidents().incidents
  const current = incidents.find((item) => item.status === 'open' && item.type === 'service-offline')
  assert.ok(current)
  assert.notEqual(current.id, 'old-incident')
  assert.equal(calls, 1)
  assert.equal(runtime.getDiagnostic('old-incident').body.status, 'available')
  assert.equal(runtime.getDiagnostic(current.id).body.status, 'available')
})
