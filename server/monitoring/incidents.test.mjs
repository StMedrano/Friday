import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState } from './state.mjs'
import { evaluateMonitoring } from './incidents.mjs'

const config = { offlineGraceSeconds: 300, historyLimit: 2000 }
const offline = {
  id: 'vm100-observer-npm',
  name: 'nginx-proxy-manager',
  category: 'container',
  host: 'VM 100',
  site: 'Site A',
  status: 'offline',
  detail: 'jc21/nginx-proxy-manager:latest',
  updated: 'Exited (255)',
}
const online = { ...offline, status: 'online', updated: 'Up 10 seconds' }
const degraded = { ...offline, status: 'degraded', updated: 'Restarting' }

function evaluate(state, services, now, alerts = [], overrides = {}) {
  return evaluateMonitoring({
    state,
    overview: { services, alerts, integrations: [] },
    config: { ...config, ...overrides },
    now,
  }).state
}

test('offline service opens once after grace, resolves, and can reoccur', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [offline], '2026-08-19T00:00:00.000Z')
  assert.equal(state.incidents.length, 0)

  state = evaluate(state, [offline], '2026-08-19T00:05:01.000Z')
  const first = state.incidents.find((incident) => incident.status === 'open')
  assert.ok(first)
  assert.equal(first.type, 'service-offline')
  assert.equal(first.serviceName, 'nginx-proxy-manager')
  assert.equal(first.host, 'VM 100')
  assert.equal(first.severity, 'high')
  assert.match(first.recommendedAction, /approval/i)

  state = evaluate(state, [offline], '2026-08-19T00:06:00.000Z')
  assert.equal(state.incidents.length, 1)
  assert.equal(state.incidents[0].id, first.id)

  state = evaluate(state, [online], '2026-08-19T00:07:00.000Z')
  assert.equal(state.incidents[0].status, 'resolved')
  assert.equal(state.incidents[0].resolvedAt, '2026-08-19T00:07:00.000Z')

  state = evaluate(state, [offline], '2026-08-19T00:08:00.000Z')
  state = evaluate(state, [offline], '2026-08-19T00:13:01.000Z')
  const open = state.incidents.filter((incident) => incident.status === 'open' && incident.type === 'service-offline')
  assert.equal(open.length, 1)
  assert.notEqual(open[0].id, first.id)
  assert.equal(state.incidents.length, 2)
})

test('degraded service opens warning after grace and resolves online', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [degraded], '2026-08-19T01:00:00.000Z', [], { offlineGraceSeconds: 60 })
  state = evaluate(state, [degraded], '2026-08-19T01:01:01.000Z', [], { offlineGraceSeconds: 60 })
  const incident = state.incidents.find((item) => item.type === 'service-degraded' && item.status === 'open')
  assert.ok(incident)
  assert.equal(incident.severity, 'warning')
  state = evaluate(state, [online], '2026-08-19T01:02:00.000Z', [], { offlineGraceSeconds: 60 })
  assert.equal(state.incidents.find((item) => item.id === incident.id).status, 'resolved')
})

test('three service transitions in fifteen minutes opens one flapping warning', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [online], '2026-08-19T02:00:00.000Z', [], { offlineGraceSeconds: 9999 })
  state = evaluate(state, [offline], '2026-08-19T02:01:00.000Z', [], { offlineGraceSeconds: 9999 })
  state = evaluate(state, [online], '2026-08-19T02:02:00.000Z', [], { offlineGraceSeconds: 9999 })
  state = evaluate(state, [offline], '2026-08-19T02:03:00.000Z', [], { offlineGraceSeconds: 9999 })
  const flap = state.incidents.find((item) => item.type === 'service-flapping' && item.status === 'open')
  assert.ok(flap)
  assert.equal(flap.severity, 'warning')
  assert.equal(state.incidents.filter((item) => item.type === 'service-flapping').length, 1)

  state = evaluate(state, [offline], '2026-08-19T02:20:00.000Z', [], { offlineGraceSeconds: 9999 })
  assert.equal(state.incidents.find((item) => item.id === flap.id).status, 'resolved')
})

test('integration degraded alert opens immediate high incident and recovery resolves it', () => {
  let state = createEmptyMonitoringState()
  const alerts = [{
    id: 'integration-0',
    title: 'Integration degraded',
    detail: 'vm100-observer: observer offline',
    severity: 'warning',
    source: 'Friday',
  }]
  state = evaluate(state, [], '2026-08-19T03:00:00.000Z', alerts)
  const incident = state.incidents.find((item) => item.type === 'integration-unavailable' && item.status === 'open')
  assert.ok(incident)
  assert.equal(incident.severity, 'high')
  assert.equal(incident.source, 'vm100-observer')
  assert.equal(incident.detail.includes('observer offline'), true)

  state = evaluate(state, [], '2026-08-19T03:01:00.000Z', [])
  assert.equal(state.incidents.find((item) => item.id === incident.id).status, 'resolved')
  assert.ok(state.history.some((event) => event.type === 'integration-recovered' && event.source === 'vm100-observer'))
})

test('history records status changes and incident lifecycle events', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [offline], '2026-08-19T04:00:00.000Z', [], { offlineGraceSeconds: 1 })
  state = evaluate(state, [offline], '2026-08-19T04:00:02.000Z', [], { offlineGraceSeconds: 1 })
  state = evaluate(state, [online], '2026-08-19T04:00:03.000Z', [], { offlineGraceSeconds: 1 })
  const types = state.history.map((event) => event.type)
  assert.ok(types.includes('incident-opened'))
  assert.ok(types.includes('service-status-changed'))
  assert.ok(types.includes('incident-resolved'))
})
