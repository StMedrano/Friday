import test from 'node:test'
import assert from 'node:assert/strict'
import { getUptimeKumaServices } from './uptime-kuma.mjs'
import { evaluateMonitoring } from '../monitoring/incidents.mjs'

const config = () => ({ enabled: true, baseUrl: 'https://kuma.example.test:3001', apiKey: 'metrics-key-secret', site: 'Site B' })
const labels = { monitor_id: '7', monitor_name: 'Remote edge', monitor_type: 'http', monitor_url: 'https://private-user:private-password@private-host.test/health?token=private-token' }
const sample = (values = labels, status = 1) => `monitor_status{${Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(',')}} ${status}`
const metrics = (...lines) => new Response(['# HELP monitor_status Monitor Status', '# TYPE monitor_status gauge', ...lines, ''].join('\n'), { headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' } })

function fixture(responses, options = {}) {
  const calls = []
  const read = settings => getUptimeKumaServices(settings, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init })
    const response = responses.shift()
    assert.ok(response, 'unexpected upstream request')
    return typeof response === 'function' ? response(url, init) : response
  } })
  return { read, calls }
}

test('Kuma is disabled by default and rejects unsafe/incomplete configuration before requests', async () => {
  const { read, calls } = fixture([])
  assert.deepEqual(await read(), [])
  assert.deepEqual(await read({ enabled: false }), [])
  for (const change of [
    { apiKey: '' }, { apiKey: 'key\nsecret' }, { site: '' }, { site: 1 }, { site: 'x'.repeat(81) },
    ...['http://kuma.test', 'https://user:pass@kuma.test', 'https://kuma.test/prefix', 'https://kuma.test?secret=x', 'https://kuma.test#secret'].map(baseUrl => ({ baseUrl })),
  ]) await assert.rejects(read({ ...config(), ...change }), { message: 'Invalid Uptime Kuma configuration' })
  assert.equal(calls.length, 0)
})

test('uses only fixed GET /metrics with an empty Basic username and metrics API key', async () => {
  const { read, calls } = fixture([metrics(sample())], { now: () => Date.parse('2026-10-25T16:00:00Z') })
  const services = await read(config())
  assert.equal(calls.length, 1)
  const [call] = calls
  assert.equal(call.url, 'https://kuma.example.test:3001/metrics')
  assert.equal(call.method, 'GET')
  assert.equal(call.headers.Authorization, `Basic ${Buffer.from(':metrics-key-secret').toString('base64')}`)
  assert.equal(call.redirect, 'error')
  assert.equal(call.credentials, 'omit')
  assert.equal(call.cache, 'no-store')
  assert.equal(call.body, undefined)
  assert.ok(call.signal)
  assert.deepEqual(services, [{
    id: 'uptime-kuma-7', name: 'Uptime Kuma · Remote edge', category: 'monitoring', host: 'kuma.example.test', site: 'Site B',
    status: 'online', detail: 'Monitor up · http', updated: '2026-10-25T16:00:00.000Z',
  }])
  assert.doesNotMatch(JSON.stringify(services), /private-|metrics-key-secret|monitor_url/)
})

test('maps down, up, pending, maintenance and unknown codes without inventing uptime', async () => {
  const { read } = fixture([metrics(...[0, 1, 2, 3, 4].map((status, index) => sample({ ...labels, monitor_id: String(index + 1) }, status)))])
  const services = await read(config())
  assert.deepEqual(services.map(s => s.status), ['offline', 'online', 'degraded', 'maintenance', 'degraded'])
  assert.match(services[2].detail, /Check pending/)
  assert.match(services[3].detail, /Maintenance/)
  assert.match(services[4].detail, /Unknown monitor status/)
})

test('stable monitor IDs survive renames, label order, target URL and health changes', async () => {
  const { read } = fixture([
    metrics(sample(), sample({ ...labels, monitor_id: '8' })),
    metrics(sample({ monitor_type: 'ping', monitor_name: 'New name', monitor_id: '8' }, 0), sample({ monitor_type: 'http', monitor_url: 'https://different.test', monitor_name: 'Renamed', monitor_id: '7' }, 2)),
  ])
  const first = await read(config())
  const second = await read(config())
  assert.equal(first[0].id, second[1].id)
  assert.equal(first[1].id, second[0].id)
})

test('parses escaped quotes, backslashes, newlines and delimiters inside label values', async () => {
  const { read } = fixture([metrics(sample({ ...labels, monitor_name: 'Edge "A", {primary} \\ path\nline' }))])
  assert.equal((await read(config()))[0].name, 'Uptime Kuma · Edge "A", {primary} \\ path line')
})

test('accepts Prometheus numeric notation, optional timestamps, and CRLF without treating timestamps as heartbeat freshness', async () => {
  const source = '# TYPE monitor_status gauge\r\n' + sample(labels, '1.0e0 1792944000000') + '\r\n' + sample({ ...labels, monitor_id: '8' }, '+0.0') + '\r\n'
  const { read } = fixture([new Response(source)], { now: () => Date.parse('2026-10-25T16:15:00Z') })
  const services = await read(config())
  assert.deepEqual(services.map(s => s.status), ['online', 'offline'])
  assert.ok(services.every(s => s.updated === '2026-10-25T16:15:00.000Z'))
})

test('ignores unrelated metric families and redacts an echoed API key in displayed labels', async () => {
  const { read } = fixture([metrics(
    'monitor_response_time{monitor_id="7",private="private-response"} 125',
    'process_cpu_seconds_total 1',
    sample({ ...labels, monitor_name: 'metrics-key-secret', monitor_type: 'metrics-key-secret', private: 'private-label' }),
  )])
  assert.doesNotMatch(JSON.stringify(await read(config())), /private-|metrics-key-secret|process_cpu|response_time/)
})

test('an explicitly empty gauge remains empty; unrelated text and login pages are rejected', async () => {
  const { read } = fixture([metrics()])
  assert.deepEqual(await read(config()), [])
  for (const response of [new Response(''), new Response('process_cpu_seconds_total 1\n'), new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } })]) {
    const { read: rejected } = fixture([response])
    await assert.rejects(rejected(config()), { message: 'Uptime Kuma invalid metrics response' })
  }
})

test('rejects malformed status samples, duplicate IDs/labels, missing IDs and unsupported escapes', async () => {
  for (const lines of [
    [sample(), sample()],
    [sample({ monitor_name: 'Old format', monitor_type: 'http' })],
    [sample({ ...labels, monitor_id: '007' })], [sample({ ...labels, monitor_id: '../escape' })],
    [sample({ ...labels, monitor_name: '' })], [sample({ ...labels, monitor_type: 'x'.repeat(81) })],
    ['monitor_status{monitor_id="7",monitor_id="8",monitor_name="Name",monitor_type="http"} 1'],
    ['monitor_status{monitor_id="7",monitor_name="bad\\tname",monitor_type="http"} 1'],
    ['monitor_status{monitor_id="7",monitor_name="Unclosed} 1'],
    ['monitor_status{monitor_id="7",monitor_name="Name",monitor_type="http"}'],
    [sample(labels, 'NaN')], [sample(labels, '+Inf')], [sample(labels, -1)], [sample(labels, '1.5')],
    [sample(labels, '1 extra')], [sample({ ...labels, extra: 'x'.repeat(2049) })],
    ['# TYPE monitor_status counter', sample()],
  ]) {
    const { read } = fixture([metrics(...lines)])
    await assert.rejects(read(config()), { message: 'Uptime Kuma invalid metrics response' })
  }
})

test('bounds monitor count and both advertised and streaming response bytes', async () => {
  const { read } = fixture([metrics(...Array.from({ length: 201 }, (_, i) => sample({ ...labels, monitor_id: String(i + 1) })))])
  await assert.rejects(read(config()), { message: 'Uptime Kuma inventory limit exceeded' })
  for (const response of [new Response('small', { headers: { 'content-length': '524289' } }), new Response('x'.repeat(524289))]) {
    const { read: bounded } = fixture([response])
    await assert.rejects(bounded(config()), { message: 'Uptime Kuma response too large' })
  }
})

test('sanitizes authentication, redirect, server and network failures', async () => {
  for (const [response, expected] of [
    [new Response('metrics-key-secret', { status: 401 }), 'Uptime Kuma authentication failed'],
    [new Response('metrics-key-secret', { status: 403 }), 'Uptime Kuma authentication failed'],
    [new Response('metrics-key-secret', { status: 503 }), 'Uptime Kuma unavailable'],
    [new Response(null, { status: 302, headers: { Location: 'https://other.test' } }), 'Uptime Kuma unavailable'],
    [() => { throw Error('metrics-key-secret') }, 'Uptime Kuma unavailable'],
  ]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), { message: expected })
  }
})

test('deadline covers response headers and streaming metrics bodies', async () => {
  for (const body of [false, true]) {
    let aborted = false
    const { read } = fixture([(_url, { signal }) => {
      if (body) return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason) }, { once: true })
      } }), { headers: { 'content-type': 'text/plain' } })
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
      })
    }], { timeoutMs: 15 })
    await assert.rejects(read(config()), { message: 'Uptime Kuma timeout' })
    assert.equal(aborted, true)
  }
})

test('monitor outages use existing grace/recovery while maintenance creates no outage', async () => {
  const { read } = fixture([metrics(sample(labels, 0)), metrics(sample(labels, 1)), metrics(sample(labels, 3))])
  const settings = { offlineGraceSeconds: 300, historyLimit: 2000 }
  const services = await read(config())
  let state = evaluateMonitoring({ overview: { services }, config: settings, now: '2026-10-25T16:00:00Z' }).state
  assert.equal(state.incidents.length, 0)
  state = evaluateMonitoring({ state, overview: { services }, config: settings, now: '2026-10-25T16:05:01Z' }).state
  assert.equal(state.incidents[0].serviceId, 'uptime-kuma-7')
  assert.equal(state.incidents[0].type, 'service-offline')
  state = evaluateMonitoring({ state, overview: { services: await read(config()) }, config: settings, now: '2026-10-25T16:06:00Z' }).state
  assert.equal(state.incidents[0].status, 'resolved')
  const maintenance = evaluateMonitoring({ overview: { services: await read(config()) }, config: { ...settings, offlineGraceSeconds: 0 }, now: '2026-10-25T16:07:00Z' }).state
  assert.equal(maintenance.incidents.length, 0)
})
