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

function incident(overrides = {}) {
  return {
    id: 'npm-offline-1', fingerprint: `service-offline:${serviceId}`, type: 'service-offline', title: 'Service offline',
    detail: 'nginx-proxy-manager is offline on VM 100', severity: 'high', status: 'open', source: 'monitoring', host: 'VM 100',
    serviceId, serviceName: 'nginx-proxy-manager', firstSeen: '2026-08-20T00:00:00.000Z', lastSeen: '2026-08-20T00:05:00.000Z',
    openedAt: '2026-08-20T00:05:00.000Z', resolvedAt: null, recommendedAction: 'Inspect only.', evidence: ['Exited (255)'],
    ...overrides,
  }
}

function overview() {
  return {
    mode: 'live',
    services: [
      { id: serviceId, name: 'nginx-proxy-manager', host: 'VM 100', status: 'offline', detail: 'jc21/nginx-proxy-manager:latest', updated: 'Exited (255)' },
      { id: 'vm100-observer-111111111111', name: 'healthy-one', host: 'VM 100', status: 'online', detail: 'healthy:latest', updated: 'Up' },
      { id: 'vm100-observer-222222222222', name: 'healthy-two', host: 'VM 100', status: 'online', detail: 'healthy:latest', updated: 'Up' },
    ],
    alerts: [], integrations: [], sites: [], resources: [], activities: [],
  }
}

function report(target, overrides = {}) {
  return {
    id: `diagnostic-${target.id}`, incidentId: target.id, source: 'vm100-observer', host: target.host, serviceId: target.serviceId,
    serviceName: target.serviceName, collectedAt: '2026-08-20T01:00:00.000Z', status: 'available', metadata: { state: 'exited', exitCode: 255 },
    facts: [{ id: 'exit-code', label: 'Exit code', value: '255' }], findings: ['old startup wording'], likelyCauses: ['old cause'],
    recommendations: ['inspect logs'], logsAvailable: true, lastLogInspectionAt: '2026-08-20T01:15:00.000Z', error: null,
    ...overrides,
  }
}

function initialState(target = incident()) {
  const state = createEmptyMonitoringState()
  state.incidents.push(target)
  state.observations[serviceId] = {
    serviceId, serviceName: target.serviceName, host: 'VM 100', status: 'offline', firstObservedAt: target.firstSeen,
    lastObservedAt: target.lastSeen, statusChangedAt: target.firstSeen, consecutive: 2, transitions: [],
  }
  state.diagnostics[target.id] = report(target)
  return state
}

function memoryStore(initial) {
  const saved = []
  return {
    saved,
    async load() { return structuredClone(initial) },
    async save(state) { saved.push(structuredClone(state)) },
  }
}

async function readyRuntime({ state = initialState(), diagnosticsEnabled = true, collectDiagnosticImpl } = {}) {
  const store = memoryStore(state)
  const runtime = createMonitoringRuntime({
    config: config(diagnosticsEnabled),
    collectOverview: async () => overview(),
    collectDiagnosticImpl,
    store,
    setIntervalImpl() { return 1 },
    now: () => new Date('2026-08-20T02:00:00.000Z'),
  })
  await runtime.start()
  return { runtime, store }
}

test('rerun replaces the stored diagnosis, preserves log inspection time, and audits success', async () => {
  let calls = 0
  const target = incident()
  const fresh = report(target, {
    collectedAt: '2026-08-20T02:00:00.000Z',
    findings: ['The container exited with a runtime/application failure rather than an OOM termination.'],
    likelyCauses: ['A runtime application or dependency failure is likely.'],
    lastLogInspectionAt: null,
  })
  const { runtime, store } = await readyRuntime({ collectDiagnosticImpl: async ({ containerId, overview: seenOverview }) => {
    calls += 1
    assert.equal(containerId, 'abcdef123456')
    assert.equal(seenOverview.services.length, 3)
    return fresh
  } })

  assert.equal(typeof runtime.rerunDiagnostic, 'function', 'runtime must expose rerunDiagnostic')
  const result = await runtime.rerunDiagnostic('npm-offline-1')

  assert.equal(calls, 1)
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.findings[0], fresh.findings[0])
  assert.equal(result.body.lastLogInspectionAt, '2026-08-20T01:15:00.000Z')
  assert.equal(runtime.getDiagnostic('npm-offline-1').body.findings[0], fresh.findings[0])
  assert.equal(store.saved.at(-1).diagnostics['npm-offline-1'].lastLogInspectionAt, '2026-08-20T01:15:00.000Z')
  assert.ok(runtime.getHistory().events.some((event) => event.type === 'diagnostic-rerun'))
})

test('rerun failure preserves the previous diagnosis and records only a sanitized failure event', async () => {
  const original = report(incident())
  const state = initialState()
  state.diagnostics['npm-offline-1'] = original
  const { runtime } = await readyRuntime({ state, collectDiagnosticImpl: async () => { throw new Error('observer token=supersecret unavailable') } })

  assert.equal(typeof runtime.rerunDiagnostic, 'function', 'runtime must expose rerunDiagnostic')
  const result = await runtime.rerunDiagnostic('npm-offline-1')

  assert.equal(result.statusCode, 502)
  assert.deepEqual(runtime.getDiagnostic('npm-offline-1').body, original)
  const event = runtime.getHistory().events.find((item) => item.type === 'diagnostic-rerun-failed')
  assert.ok(event)
  assert.equal(event.detail.includes('supersecret'), false)
})

test('rerun rejects missing, disabled, and unsupported incidents without diagnostic collection', async () => {
  let calls = 0
  const collector = async () => { calls += 1; return {} }
  const disabled = await readyRuntime({ diagnosticsEnabled: false, collectDiagnosticImpl: collector })
  assert.equal(typeof disabled.runtime.rerunDiagnostic, 'function', 'runtime must expose rerunDiagnostic')
  assert.equal((await disabled.runtime.rerunDiagnostic('npm-offline-1')).statusCode, 409)

  const unsupportedIncident = incident({ id: 'integration-1', type: 'integration-unavailable', serviceId: undefined })
  const unsupportedState = createEmptyMonitoringState()
  unsupportedState.incidents.push(unsupportedIncident)
  const unsupported = await readyRuntime({ state: unsupportedState, collectDiagnosticImpl: collector })
  assert.equal((await unsupported.runtime.rerunDiagnostic('integration-1')).statusCode, 409)
  assert.equal((await unsupported.runtime.rerunDiagnostic('missing')).statusCode, 404)
  assert.equal(calls, 0)
})
