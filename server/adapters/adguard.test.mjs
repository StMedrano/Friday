import test from 'node:test'
import assert from 'node:assert/strict'
import { getAdguardServices } from './adguard.mjs'
import { evaluateMonitoring } from '../monitoring/incidents.mjs'

const config = () => ({ enabled: true, baseUrl: 'https://dns.example.test:8443', username: 'reader', password: 'private-password', site: 'Site B' })
const status = { running: true, protection_enabled: true }
const stats = { num_dns_queries: 120, num_blocked_filtering: 30, avg_processing_time: 0.0025 }
const json = value => Response.json(value)

function fixture(responses, options = {}) {
  const calls = []
  const read = settings => getAdguardServices(settings, { ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init })
    const response = responses.shift()
    assert.ok(response, 'unexpected upstream request')
    return typeof response === 'function' ? response(url, init) : response
  } })
  return { calls, read }
}

test('disabled AdGuard makes no requests and requires no credentials', async () => {
  const { read, calls } = fixture([])
  assert.deepEqual(await read(), [])
  assert.deepEqual(await read({ enabled: false }), [])
  assert.equal(calls.length, 0)
})

test('requires explicit site, credentials, and a trusted HTTPS origin', async () => {
  for (const changes of [
    { username: '' }, { username: 'user:name' }, { username: 'user\nname' }, { password: '' }, { password: 'secret\rvalue' },
    { site: '' }, { site: 'x'.repeat(81) }, { site: 'Site\nB' }, { site: 42 },
    ...['http://dns.test', 'https://user:pass@dns.test', 'https://dns.test/path', 'https://dns.test?token=secret', 'https://dns.test#secret', 'file:///etc/passwd'].map(baseUrl => ({ baseUrl })),
  ]) {
    const { read, calls } = fixture([])
    await assert.rejects(read({ ...config(), ...changes }), { message: 'Invalid AdGuard configuration' })
    assert.equal(calls.length, 0)
  }
})

test('reads only status and aggregate statistics using server-side Basic authentication', async () => {
  const { read, calls } = fixture([
    json({ ...status, version: 'private-password', dns_addresses: ['private-address'], language: 'en' }),
    json({ ...stats, top_queried_domains: [{ 'private-domain.test': 42 }], top_clients: [{ 'private-client': 10 }], dns_queries: [1, 2], extra: 'private-password' }),
  ], { now: () => Date.parse('2026-10-25T14:00:00Z') })
  const services = await read(config())
  assert.deepEqual(calls.map(c => c.url), ['https://dns.example.test:8443/control/status', 'https://dns.example.test:8443/control/stats'])
  for (const call of calls) {
    assert.equal(call.method, 'GET')
    assert.equal(call.headers.Authorization, `Basic ${Buffer.from('reader:private-password').toString('base64')}`)
    assert.equal(call.redirect, 'error')
    assert.equal(call.credentials, 'omit')
    assert.equal(call.cache, 'no-store')
    assert.equal(call.body, undefined)
    assert.ok(call.signal)
  }
  assert.deepEqual(services, [{
    id: 'adguard', name: 'AdGuard Home', category: 'dns', host: 'dns.example.test', site: 'Site B', status: 'online',
    detail: 'DNS running · Protection enabled · 120 queries · 30 filtered · 2.5 ms avg (configured statistics window)',
    updated: '2026-10-25T14:00:00.000Z',
  }])
  assert.doesNotMatch(JSON.stringify(services), /private-|top_clients|top_queried|dns_queries|Authorization/)
})

test('process stopped is offline; protection disabled is degraded; empty statistics remain zero', async () => {
  for (const [running, protection, expected] of [[false, true, 'offline'], [false, false, 'offline'], [true, false, 'degraded'], [true, true, 'online']]) {
    const { read } = fixture([json({ running, protection_enabled: protection }), json({ num_dns_queries: 0, num_blocked_filtering: 0, avg_processing_time: 0 })])
    const [service] = await read(config())
    assert.equal(service.status, expected)
    assert.match(service.detail, running ? /DNS running/ : /DNS stopped/)
    assert.match(service.detail, protection ? /Protection enabled/ : /Protection disabled/)
    assert.match(service.detail, /0 queries · 0 filtered · 0 ms avg/)
  }
})

test('invalid or missing fields never become fabricated healthy state or zero statistics', async () => {
  for (const invalid of [null, [], {}, { ...status, running: 'true' }, { ...status, protection_enabled: 1 }]) {
    const { read, calls } = fixture([json(invalid)])
    await assert.rejects(read(config()), { message: 'AdGuard invalid status response' })
    assert.equal(calls.length, 1)
  }
  for (const invalid of [
    null, [], {}, { ...stats, num_dns_queries: '120' }, { ...stats, num_dns_queries: -1 },
    { ...stats, num_dns_queries: 1.5 }, { ...stats, num_dns_queries: Number.MAX_SAFE_INTEGER + 1 },
    { ...stats, num_blocked_filtering: 121 }, { ...stats, num_blocked_filtering: -1 },
    { ...stats, avg_processing_time: null }, { ...stats, avg_processing_time: -0.1 },
    { ...stats, avg_processing_time: 1e308 },
  ]) {
    const { read } = fixture([json(status), json(invalid)])
    await assert.rejects(read(config()), { message: 'AdGuard invalid statistics response' })
  }
})

test('HTTP, JSON, and network errors disclose no credentials or upstream body', async () => {
  for (const [response, expected] of [
    [new Response('private-password', { status: 401 }), 'AdGuard authentication failed'],
    [new Response('private-password', { status: 403 }), 'AdGuard authentication failed'],
    [new Response('private-password', { status: 500 }), 'AdGuard unavailable'],
    [new Response(null, { status: 302, headers: { Location: 'https://other.test' } }), 'AdGuard unavailable'],
    [new Response('private-password'), 'AdGuard invalid JSON response'],
    [() => { throw Error('private-password') }, 'AdGuard unavailable'],
  ]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), { message: expected })
  }
  const { read } = fixture([json(status), new Response('private-password', { status: 403 })])
  await assert.rejects(read(config()), { message: 'AdGuard authentication failed' })
})

test('both advertised and streamed response sizes are bounded', async () => {
  for (const oversized of [
    new Response('small', { headers: { 'content-length': String(512 * 1024 + 1) } }),
    new Response('x'.repeat(512 * 1024 + 1)),
  ]) {
    const { read } = fixture([json(status), oversized])
    await assert.rejects(read(config()), { message: 'AdGuard response too large' })
  }
})

test('one deadline bounds status, statistics, and streaming bodies', async () => {
  for (const stallAt of ['status', 'stats', 'body']) {
    let aborted = false
    const stall = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
    })
    const body = (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason) }, { once: true })
    } }))
    const responses = stallAt === 'status' ? [stall] : [json(status), stallAt === 'stats' ? stall : body]
    const { read, calls } = fixture(responses, { timeoutMs: 15 })
    await assert.rejects(read(config()), { message: 'AdGuard timeout' })
    assert.equal(aborted, true)
    assert.ok(calls.every(call => call.signal === calls[0].signal))
  }
})

test('stopped DNS enters the existing incident grace period and resolves after recovery', async () => {
  const { read } = fixture([json({ ...status, running: false }), json(stats), json(status), json(stats)])
  const services = await read(config())
  const settings = { offlineGraceSeconds: 300, historyLimit: 2000 }
  let state = evaluateMonitoring({ overview: { services }, config: settings, now: '2026-10-25T14:00:00Z' }).state
  assert.equal(state.incidents.length, 0)
  state = evaluateMonitoring({ state, overview: { services }, config: settings, now: '2026-10-25T14:05:01Z' }).state
  assert.equal(state.incidents[0].type, 'service-offline')
  assert.equal(state.incidents[0].serviceId, 'adguard')
  state = evaluateMonitoring({ state, overview: { services: await read(config()) }, config: settings, now: '2026-10-25T14:06:00Z' }).state
  assert.equal(state.incidents[0].status, 'resolved')
})
