import test from 'node:test'
import assert from 'node:assert/strict'
import { getGrafanaServices } from './grafana.mjs'
import { evaluateMonitoring } from '../monitoring/incidents.mjs'

const config = () => ({ enabled: true, baseUrl: 'https://grafana.example.test', token: 'glsa_private-token', site: 'Site A' })
const health = (overrides = {}) => Response.json({ commit: 'abc', database: 'ok', version: '11.2.0', ...overrides })
const rule = (overrides = {}) => ({
  name: 'High CPU', type: 'alerting', state: 'inactive', health: 'ok', labels: { severity: 'critical' },
  query: 'private-query', annotations: { summary: 'private-annotation' }, alerts: [{ labels: { instance: 'private-instance' } }], ...overrides,
})
const rules = (items, group = { name: 'Nodes', file: 'Homelab' }) =>
  Response.json({ status: 'success', data: { groups: [{ ...group, rules: items }] } })

function fixture(responses, options = {}) {
  const calls = []
  const read = settings => getGrafanaServices(settings, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init })
    const response = responses.shift()
    assert.ok(response, 'unexpected request')
    return typeof response === 'function' ? response(url, init) : response
  } })
  return { calls, read }
}

test('Grafana stays inert until explicitly enabled and configured', async () => {
  const { read, calls } = fixture([])
  assert.deepEqual(await read(), [])
  assert.deepEqual(await read({ enabled: false }), [])
  for (const changes of [
    { token: '' }, { token: 'x\ny' }, { token: 'x'.repeat(4097) }, { site: '' }, { site: 'x'.repeat(81) },
    ...['http://grafana.test', 'https://user:pass@grafana.test', 'https://grafana.test/sub', 'https://grafana.test?x=1', 'https://grafana.test#x'].map(baseUrl => ({ baseUrl })),
  ]) await assert.rejects(read({ ...config(), ...changes }), { message: 'Invalid Grafana configuration' })
  assert.equal(calls.length, 0)
})

test('uses only fixed health and alert-rule GETs with a server-side bearer token', async () => {
  const { read, calls } = fixture([health(), rules([rule()])])
  const services = await read(config())
  assert.deepEqual(calls.map(call => call.url), [
    'https://grafana.example.test/api/health',
    'https://grafana.example.test/api/prometheus/grafana/api/v1/rules',
  ])
  for (const call of calls) {
    assert.equal(call.method, 'GET')
    assert.equal(call.headers.Authorization, 'Bearer glsa_private-token')
    assert.equal(call.redirect, 'error')
    assert.equal(call.credentials, 'omit')
    assert.equal(call.body, undefined)
    assert.ok(call.signal)
  }
  const [grafana, alert] = services
  assert.deepEqual({ ...grafana, updated: undefined }, {
    id: 'grafana', name: 'Grafana', category: 'monitoring', host: 'grafana.example.test', site: 'Site A',
    status: 'online', detail: 'Database ok · v11.2.0 · 0 firing of 1 alert rules', updated: undefined,
  })
  assert.match(alert.id, /^grafana-rule-[a-f0-9]{64}$/)
  assert.deepEqual({ ...alert, id: undefined, updated: undefined }, {
    id: undefined, name: 'Grafana alert · High CPU', category: 'monitoring', host: 'Homelab / Nodes', site: 'Site A',
    status: 'online', detail: 'Alert inactive · critical · Alert rule state, not service health', updated: undefined,
  })
})

test('maps alert state and rule health conservatively', async () => {
  const { read } = fixture([health({ database: 'failing' }), rules([
    rule({ name: 'Firing', state: 'firing' }),
    rule({ name: 'Pending', state: 'pending', labels: {} }),
    rule({ name: 'Broken', health: 'error' }),
    rule({ name: 'No data', health: 'nodata' }),
    rule({ name: 'Future', state: 'something-new' }),
    rule({ name: 'Recording', type: 'recording' }),
  ])])
  const [grafana, firing, pending, broken, nodata, future] = await read(config())
  assert.equal(grafana.status, 'degraded')
  assert.match(grafana.detail, /^Database not ok · v11\.2\.0 · 1 firing of 5 alert rules$/)
  assert.deepEqual([firing.status, pending.status, broken.status, nodata.status, future.status], ['degraded', 'online', 'degraded', 'degraded', 'degraded'])
  assert.match(firing.detail, /^Alert firing · critical/)
  assert.match(pending.detail, /^Alert pending · Alert rule/)
  assert.match(broken.detail, /^Rule evaluation error/)
  assert.match(nodata.detail, /^Rule has no data/)
  assert.match(future.detail, /^Alert state unknown/)
})

test('rule IDs are stable across order and state and distinguish folder, group and name', async () => {
  const { read } = fixture([
    health(), Response.json({ status: 'success', data: { groups: [
      { name: 'Nodes', file: 'Homelab', rules: [rule(), rule({ name: 'Disk' })] },
      { name: 'Other', file: 'Homelab', rules: [rule()] },
    ] } }),
    health(), Response.json({ status: 'success', data: { groups: [
      { name: 'Nodes', file: 'Homelab', rules: [rule({ name: 'Disk' }), rule({ state: 'firing' })] },
    ] } }),
  ])
  const first = (await read(config())).slice(1)
  const second = (await read(config())).slice(1)
  assert.equal(new Set(first.map(item => item.id)).size, 3)
  assert.equal(first[0].id, second[1].id)
  assert.equal(first[1].id, second[0].id)
})

test('never exposes queries, annotations, alert instances, labels or the token', async () => {
  const { read } = fixture([health({ version: 'glsa_private-token' }), rules([rule({ name: 'glsa_private-token', labels: { severity: 'warning', owner: 'private-owner' } })])])
  const output = JSON.stringify(await read(config()))
  assert.doesNotMatch(output, /private-|glsa_|annotation|query/)
})

test('rejects malformed, duplicate and oversized responses rather than returning partial state', async () => {
  const tooMany = Array.from({ length: 201 }, (_, i) => rule({ name: `rule-${i}` }))
  for (const responses of [
    [Response.json({ database: 5 })],
    [Response.json([])],
    [health(), Response.json({ status: 'error', error: 'private' })],
    [health(), Response.json({ status: 'success', data: {} })],
    [health(), rules([rule(), rule()])],
    [health(), rules(tooMany)],
    [health(), rules([rule({ name: '' })])],
    [health(), rules([rule({ name: 'bad\nname' })])],
    [health(), rules([rule({ state: 5 })])],
    [health(), rules([rule({ labels: [] })])],
    [health(), rules([rule()], { name: 'Nodes', file: 7 })],
    [health(), rules([null])],
  ]) {
    const { read } = fixture(responses)
    await assert.rejects(read(config()), error => /^Grafana (invalid response|inventory limit exceeded|request rejected)$/.test(error.message), JSON.stringify(responses.length))
  }
})

test('HTTP, JSON and transport failures are sanitized', async () => {
  for (const [responses, expected] of [
    [[new Response('private', { status: 401 })], 'Grafana authentication failed'],
    [[health(), new Response('private', { status: 403 })], 'Grafana authentication failed'],
    [[new Response('private', { status: 503 })], 'Grafana unavailable'],
    [[new Response('private')], 'Grafana invalid JSON response'],
    [[() => { throw Error('glsa_private-token') }], 'Grafana unavailable'],
  ]) {
    const { read } = fixture(responses)
    await assert.rejects(read(config()), { message: expected })
  }
})

test('limits bodies and applies one deadline across both requests', async () => {
  for (const response of [new Response('x', { headers: { 'content-length': '524289' } }), new Response('x'.repeat(524289))]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), { message: 'Grafana response too large' })
  }
  let aborted = false
  const { read } = fixture([health(), (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
  })], { timeoutMs: 15 })
  await assert.rejects(read(config()), { message: 'Grafana timeout' })
  assert.equal(aborted, true)
})

test('firing rules become warning incidents after the grace period and resolve under the same identity', async () => {
  const { read } = fixture([health(), rules([rule({ state: 'firing' })]), health(), rules([rule()])])
  const services = await read(config())
  const settings = { offlineGraceSeconds: 300, historyLimit: 2000 }
  let state = evaluateMonitoring({ overview: { services }, config: settings, now: '2026-10-28T12:00:00Z' }).state
  assert.equal(state.incidents.length, 0)
  state = evaluateMonitoring({ state, overview: { services }, config: settings, now: '2026-10-28T12:05:01Z' }).state
  assert.equal(state.incidents[0].type, 'service-degraded')
  assert.equal(state.incidents[0].severity, 'warning')
  state = evaluateMonitoring({ state, overview: { services: await read(config()) }, config: settings, now: '2026-10-28T12:06:00Z' }).state
  assert.equal(state.incidents[0].status, 'resolved')
})
