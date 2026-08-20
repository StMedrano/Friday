import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState } from './state.mjs'
import { createMonitoringRuntime } from './runtime.mjs'

function config(enabled = true) {
  return {
    monitoring: {
      enabled,
      pollSeconds: 30,
      offlineGraceSeconds: 0,
      historyLimit: 50,
      statePath: '/tmp/unused.json',
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
