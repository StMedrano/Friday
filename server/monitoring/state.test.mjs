import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from '../config.mjs'
import {
  appendHistory,
  createEmptyMonitoringState,
  incidentList,
  monitoringSummary,
  normalizeMonitoringState,
} from './state.mjs'

test('monitoring config is safe and disabled by default', () => {
  const config = getConfig({})
  assert.deepEqual(config.monitoring, {
    enabled: false,
    pollSeconds: 30,
    offlineGraceSeconds: 300,
    statePath: '/data/monitoring-state.json',
    historyLimit: 2000,
  })
})

test('monitoring config accepts explicit server-side overrides', () => {
  const config = getConfig({
    FRIDAY_MONITORING_ENABLED: 'true',
    FRIDAY_MONITORING_POLL_SECONDS: '15',
    FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS: '60',
    FRIDAY_MONITORING_STATE_PATH: '/tmp/state.json',
    FRIDAY_MONITORING_HISTORY_LIMIT: '10',
  })
  assert.equal(config.monitoring.enabled, true)
  assert.equal(config.monitoring.pollSeconds, 15)
  assert.equal(config.monitoring.offlineGraceSeconds, 60)
  assert.equal(config.monitoring.statePath, '/tmp/state.json')
  assert.equal(config.monitoring.historyLimit, 10)
})

test('monitoring config rejects zero and invalid numeric values', () => {
  const config = getConfig({
    FRIDAY_MONITORING_POLL_SECONDS: '0',
    FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS: '-1',
    FRIDAY_MONITORING_HISTORY_LIMIT: 'not-a-number',
  })
  assert.equal(config.monitoring.pollSeconds, 30)
  assert.equal(config.monitoring.offlineGraceSeconds, 300)
  assert.equal(config.monitoring.historyLimit, 2000)
})

test('empty monitoring state uses schema version two with diagnostics map', () => {
  assert.deepEqual(createEmptyMonitoringState(), {
    schemaVersion: 2,
    observations: {},
    incidents: [],
    history: [],
    diagnostics: {},
  })
})

test('legacy v1 monitoring state upgrades without losing incidents or history', () => {
  const legacy = {
    schemaVersion: 1,
    observations: { svc: { status: 'offline' } },
    incidents: [{ id: 'i1', status: 'open' }],
    history: [{ id: 'h1', type: 'incident-opened' }],
  }
  const upgraded = normalizeMonitoringState(legacy)
  assert.equal(upgraded.schemaVersion, 2)
  assert.deepEqual(upgraded.observations, legacy.observations)
  assert.deepEqual(upgraded.incidents, legacy.incidents)
  assert.deepEqual(upgraded.history, legacy.history)
  assert.deepEqual(upgraded.diagnostics, {})
})

test('existing diagnostics survive state normalization', () => {
  const diagnostic = { id: 'd1', incidentId: 'i1', status: 'available' }
  const upgraded = normalizeMonitoringState({
    schemaVersion: 2,
    observations: {},
    incidents: [{ id: 'i1', status: 'open' }],
    history: [],
    diagnostics: { i1: diagnostic },
  })
  assert.deepEqual(upgraded.diagnostics, { i1: diagnostic })
})

test('malformed diagnostics field is normalized without discarding monitoring data', () => {
  const upgraded = normalizeMonitoringState({
    schemaVersion: 2,
    observations: {},
    incidents: [{ id: 'i1', status: 'open' }],
    history: [{ id: 'h1', type: 'incident-opened' }],
    diagnostics: ['not-a-map'],
  })
  assert.deepEqual(upgraded.diagnostics, {})
  assert.equal(upgraded.incidents[0].id, 'i1')
  assert.equal(upgraded.history[0].id, 'h1')
})

test('history is oldest-first capped at configured size', () => {
  const state = createEmptyMonitoringState()
  appendHistory(state, { id: '1', type: 'a', at: '2026-08-19T00:00:00.000Z' }, 2)
  appendHistory(state, { id: '2', type: 'b', at: '2026-08-19T00:01:00.000Z' }, 2)
  appendHistory(state, { id: '3', type: 'c', at: '2026-08-19T00:02:00.000Z' }, 2)
  assert.deepEqual(state.history.map((event) => event.id), ['2', '3'])
})

test('incidentList returns open first then recently resolved', () => {
  const state = createEmptyMonitoringState()
  state.incidents = [
    { id: 'resolved', status: 'resolved', openedAt: '2026-08-19T00:00:00.000Z', resolvedAt: '2026-08-19T00:03:00.000Z' },
    { id: 'open', status: 'open', openedAt: '2026-08-19T00:02:00.000Z', resolvedAt: null },
  ]
  assert.deepEqual(incidentList(state).map((incident) => incident.id), ['open', 'resolved'])
})

test('monitoringSummary reports active incident severities and runtime metadata', () => {
  const state = createEmptyMonitoringState()
  state.incidents = [
    { id: 'high', status: 'open', severity: 'high' },
    { id: 'warning', status: 'open', severity: 'warning' },
    { id: 'resolved', status: 'resolved', severity: 'high' },
  ]
  const summary = monitoringSummary(state, {
    enabled: true,
    status: 'degraded',
    lastPollAt: '2026-08-19T00:05:00.000Z',
    lastSuccessAt: '2026-08-19T00:04:30.000Z',
    lastError: 'observer unavailable',
  })
  assert.deepEqual(summary, {
    enabled: true,
    status: 'degraded',
    lastPollAt: '2026-08-19T00:05:00.000Z',
    lastSuccessAt: '2026-08-19T00:04:30.000Z',
    lastError: 'observer unavailable',
    activeIncidents: 2,
    openHigh: 1,
    openWarning: 1,
  })
})
