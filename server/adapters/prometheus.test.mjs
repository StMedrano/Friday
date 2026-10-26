import test from 'node:test'
import assert from 'node:assert/strict'
import { getPrometheusServices } from './prometheus.mjs'
import { evaluateMonitoring } from '../monitoring/incidents.mjs'

const config = () => ({ enabled: true, baseUrl: 'https://prometheus.example.test:9090', username: 'friday-reader', password: 'private-password', site: 'Site A' })
const target = (overrides = {}) => ({
  labels: { job: 'node-exporter', instance: 'node-a.test:9100' }, scrapePool: 'node-exporter',
  health: 'up', lastScrape: '2026-10-25T15:30:00.123456789Z', ...overrides,
})
const payload = targets => Response.json({ status: 'success', data: { activeTargets: targets, droppedTargets: [] } })

function fixture(responses, options = {}) {
  const calls = []
  const read = settings => getPrometheusServices(settings, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init })
    const response = responses.shift()
    assert.ok(response, 'unexpected request')
    return typeof response === 'function' ? response(url, init) : response
  } })
  return { calls, read }
}

test('Prometheus stays inert until explicitly enabled and configured', async () => {
  const { read, calls } = fixture([])
  assert.deepEqual(await read(), [])
  assert.deepEqual(await read({ enabled: false }), [])
  assert.equal(calls.length, 0)
  for (const changes of [
    { username: '' }, { username: 'user:name' }, { password: '' }, { password: 'x\ny' },
    { site: '' }, { site: 'x'.repeat(81) }, { site: 4 },
    ...['http://prom.test', 'https://user:pass@prom.test', 'https://prom.test/path', 'https://prom.test?token=secret', 'https://prom.test#secret'].map(baseUrl => ({ baseUrl })),
  ]) await assert.rejects(read({ ...config(), ...changes }), { message: 'Invalid Prometheus configuration' })
  assert.equal(calls.length, 0)
})

test('uses only the fixed active-target GET with server-side Basic authentication', async () => {
  const { read, calls } = fixture([payload([target()])])
  const [service] = await read(config())
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.url, 'https://prometheus.example.test:9090/api/v1/targets?state=active')
  assert.equal(call.method, 'GET')
  assert.equal(call.headers.Authorization, `Basic ${Buffer.from('friday-reader:private-password').toString('base64')}`)
  assert.equal(call.redirect, 'error')
  assert.equal(call.credentials, 'omit')
  assert.equal(call.cache, 'no-store')
  assert.equal(call.body, undefined)
  assert.ok(call.signal)
  assert.match(service.id, /^prometheus-[a-f0-9]{64}$/)
  assert.deepEqual({ ...service, id: undefined }, {
    id: undefined, name: 'Prometheus · node-exporter', category: 'monitoring', host: 'node-a.test:9100', site: 'Site A',
    status: 'online', detail: 'Scrape successful · Application health not assessed', updated: '2026-10-25T15:30:00.123Z',
  })
})

test('maps scrape health conservatively and uses explicit target site labels', async () => {
  const { read } = fixture([payload([
    target({ health: 'down', labels: { job: 'node', instance: 'node-b.test:9100', site: 'Site B' } }),
    target({ health: 'unknown', lastScrape: '0001-01-01T00:00:00Z' }),
    target({ health: 'future-state', scrapePool: 'future-pool' }),
  ])])
  const [down, unknown, future] = await read(config())
  assert.equal(down.status, 'offline')
  assert.equal(down.site, 'Site B')
  assert.match(down.detail, /Scrape failed/)
  assert.equal(unknown.status, 'degraded')
  assert.equal(unknown.updated, 'Not yet scraped')
  assert.equal(future.status, 'degraded')
  assert.match(future.detail, /Scrape health unknown/)
})

test('IDs survive label ordering, target ordering and health changes, and distinguish pools/labels', async () => {
  const { read } = fixture([
    payload([target(), target({ scrapePool: 'other-pool' }), target({ labels: { job: 'node-exporter', instance: 'node-a.test:9100', replica: 'b' } })]),
    payload([target({ scrapePool: 'other-pool' }), target({ labels: { instance: 'node-a.test:9100', job: 'node-exporter' }, health: 'down' })]),
  ])
  const first = await read(config())
  const second = await read(config())
  assert.equal(first[0].id, second[1].id)
  assert.equal(first[1].id, second[0].id)
  assert.equal(new Set(first.map(item => item.id)).size, 3)
})

test('drops raw labels, discovery data, errors, URLs and credentials from public services', async () => {
  const { read } = fixture([Response.json({ status: 'success', data: {
    activeTargets: [target({
      labels: { job: 'node-exporter', instance: 'https://user:password@node.test:9100/metrics?token=private-query', owner: 'private-owner', site: 'Site B' },
      scrapeUrl: 'https://private-url.test/?secret=value', globalUrl: 'https://private-url.test',
      discoveredLabels: { secret: 'private-discovery' }, lastError: 'private-password',
    })], droppedTargets: [{ secret: 'private-dropped' }],
  } })])
  const services = await read(config())
  assert.equal(services[0].host, 'node.test:9100')
  assert.doesNotMatch(JSON.stringify(services), /private-|password|discoveredLabels|lastError|scrapeUrl|owner|https:\/\//)
})

test('empty active inventory does not fabricate targets from dropped entries', async () => {
  const { read } = fixture([Response.json({ status: 'success', data: { activeTargets: [], droppedTargets: [target()] } })])
  assert.deepEqual(await read(config()), [])
})

test('redacts known authentication values if upstream echoes them in public labels', async () => {
  const { read } = fixture([payload([target({ labels: { job: 'friday-reader', instance: 'node.test', site: 'private-password' } })])])
  assert.doesNotMatch(JSON.stringify(await read(config())), /friday-reader|private-password/)
})

test('rejects malformed, duplicate and oversized inventories rather than returning partial state', async () => {
  for (const response of [
    Response.json({ status: 'error', error: 'private-password' }),
    Response.json({ status: 'success', data: {} }),
    Response.json({ status: 'success', data: { activeTargets: null } }),
    payload([target(), target()]), payload(Array.from({ length: 201 }, (_, i) => target({ scrapePool: `pool-${i}` }))),
    ...[
      null, { ...target(), labels: [] }, target({ labels: { job: 'node' } }),
      target({ labels: { job: 'node', instance: 'node.test', site: 42 } }),
      target({ labels: { job: 'node', instance: 'file:///etc/passwd' } }),
      target({ labels: { job: 'node', instance: 'node.test', extra: {} } }),
      target({ labels: { job: 'node\nsecret', instance: 'node.test' } }),
      target({ scrapePool: '' }), target({ health: null }), target({ lastScrape: 'invalid' }),
      target({ lastScrape: '0001-01-01T00:00:00Z' }),
    ].map(item => payload([item])),
  ]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), error => /^Prometheus (invalid response|inventory limit exceeded|request rejected)$/.test(error.message))
  }
})

test('HTTP, JSON and transport failures are sanitized', async () => {
  for (const [response, expected] of [
    [new Response('private-password', { status: 401 }), 'Prometheus authentication failed'],
    [new Response('private-password', { status: 403 }), 'Prometheus authentication failed'],
    [new Response('private-password', { status: 503 }), 'Prometheus unavailable'],
    [new Response(null, { status: 302, headers: { Location: 'https://other.test' } }), 'Prometheus unavailable'],
    [new Response('private-password'), 'Prometheus invalid JSON response'],
    [() => { throw Error('private-password') }, 'Prometheus unavailable'],
  ]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), { message: expected })
  }
})

test('limits both declared and streamed bodies and times out headers or body reads', async () => {
  for (const response of [new Response('x', { headers: { 'content-length': '524289' } }), new Response('x'.repeat(524289))]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), { message: 'Prometheus response too large' })
  }
  for (const stream of [false, true]) {
    let aborted = false
    const { read } = fixture([(_url, { signal }) => {
      if (stream) return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason) }, { once: true })
      } }))
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
      })
    }], { timeoutMs: 15 })
    await assert.rejects(read(config()), { message: 'Prometheus timeout' })
    assert.equal(aborted, true)
  }
})

test('scrape failures enter monitoring grace periods and resolve under the same identity', async () => {
  const { read } = fixture([payload([target({ health: 'down' })]), payload([target()])])
  const services = await read(config())
  const settings = { offlineGraceSeconds: 300, historyLimit: 2000 }
  let state = evaluateMonitoring({ overview: { services }, config: settings, now: '2026-10-25T15:30:00Z' }).state
  assert.equal(state.incidents.length, 0)
  state = evaluateMonitoring({ state, overview: { services }, config: settings, now: '2026-10-25T15:35:01Z' }).state
  assert.equal(state.incidents[0].type, 'service-offline')
  assert.match(state.incidents[0].serviceName, /^Prometheus ·/)
  assert.ok(state.incidents[0].evidence.some(value => value.includes('Scrape failed')))
  state = evaluateMonitoring({ state, overview: { services: await read(config()) }, config: settings, now: '2026-10-25T15:36:00Z' }).state
  assert.equal(state.incidents[0].status, 'resolved')
})
