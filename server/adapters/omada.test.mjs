import test from 'node:test'
import assert from 'node:assert/strict'
import { createOmadaAdapter } from './omada.mjs'

const config = () => ({ enabled: true, baseUrl: 'https://omada.example.test:8043', controllerId: 'controller-1', clientId: 'client-id', clientSecret: 'client-secret' })
const json = result => Response.json({ errorCode: 0, result })
const token = () => json({ accessToken: 'access-secret', expiresIn: 7200 })
const page = (data, totalRows = data.length) => json({ data, totalRows })
const site = { siteId: 'site-a', name: 'Site A' }
const device = { mac: 'AA-BB-CC-DD-EE-01', name: 'Gateway', model: 'ER605', status: 1 }

function fixture(responses, options = {}) {
  const calls = []
  const read = createOmadaAdapter({ ...options, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), ...init })
    const response = responses.shift()
    assert.ok(response, 'unexpected request')
    return typeof response === 'function' ? response(url, init) : response
  } })
  return { read, calls }
}

test('disabled Omada makes no requests or credential demands', async () => {
  const { read, calls } = fixture([])
  assert.deepEqual(await read(), [])
  assert.deepEqual(await read({ enabled: false }), [])
  assert.equal(calls.length, 0)
})

test('Omada rejects unsafe or incomplete configuration before authenticating', async () => {
  for (const changes of [
    { clientSecret: '' }, { clientId: '' }, { controllerId: '../escape' },
    { controllerId: undefined }, { controllerId: 123 }, { controllerId: null },
    ...['http://omada.test', 'https://user:secret@omada.test', 'https://omada.test?key=secret', 'https://omada.test/#secret', 'https://omada.test/prefix'].map(baseUrl => ({ baseUrl })),
  ]) {
    const { read, calls } = fixture([])
    await assert.rejects(read({ ...config(), ...changes }), { message: 'Invalid Omada configuration' })
    assert.equal(calls.length, 0)
  }
})

test('authenticates server-side then uses only fixed GET inventory routes and normalized fields', async () => {
  const { read, calls } = fixture([
    token(), page([{ ...site, deviceAccount: { password: 'private-value' } }, { siteId: 'site-b', name: 'Site B' }]),
    page([device, { ...device, mac: 'AA-BB-CC-DD-EE-02', name: 'Switch', status: 0, password: 'private-value' }]),
    page([{ ...device, name: 'Remote AP', status: 999 }]),
  ])
  const services = await read(config())
  assert.deepEqual(calls.map(c => [new URL(c.url).pathname, c.method]), [
    ['/openapi/authorize/token', 'POST'],
    ['/openapi/v1/controller-1/sites', 'GET'],
    ['/openapi/v1/controller-1/sites/site-a/devices', 'GET'],
    ['/openapi/v1/controller-1/sites/site-b/devices', 'GET'],
  ])
  assert.deepEqual(JSON.parse(calls[0].body), { omadacId: 'controller-1', client_id: 'client-id', client_secret: 'client-secret' })
  assert.equal(new URL(calls[0].url).searchParams.get('grant_type'), 'client_credentials')
  for (const call of calls) {
    assert.equal(call.redirect, 'error')
    assert.equal(call.credentials, 'omit')
    assert.ok(call.signal)
    assert.doesNotMatch(call.url, /client-secret|access-secret/)
  }
  assert.ok(calls.slice(1).every(c => c.headers.Authorization === 'AccessToken=access-secret' && !c.body))
  assert.equal(services.length, 5)
  assert.equal(services.find(s => s.id === 'omada-site-site-a').status, 'degraded')
  assert.equal(services.find(s => s.id === 'omada-device-site-a-aa-bb-cc-dd-ee-01').status, 'online')
  assert.equal(services.find(s => s.name === 'Switch').status, 'offline')
  assert.equal(services.find(s => s.name === 'Remote AP').status, 'degraded')
  assert.match(services.find(s => s.name === 'Remote AP').detail, /Unknown device status/)
  assert.equal(services.find(s => s.name === 'Remote AP').site, 'Site B')
  assert.ok(services.every(s => s.category === 'network'))
  assert.doesNotMatch(JSON.stringify(services), /secret|private-value|deviceAccount|password/)
})

test('follows short pages until totalRows is satisfied, keeping site-scoped stable identities', async () => {
  const { read, calls } = fixture([
    token(), page([site], 2), page([{ siteId: 'site-b', name: 'Site B' }], 2),
    page([device], 2), page([{ ...device, mac: 'AA-BB-CC-DD-EE-02' }], 2), page([device]),
  ])
  const services = await read(config())
  assert.equal(services.length, 5)
  assert.equal(new Set(services.map(s => s.id)).size, 5)
  assert.deepEqual(calls.slice(1).map(c => new URL(c.url).searchParams.get('page')), ['1', '2', '1', '2', '1'])
})

test('empty inventory never claims that a site is healthy', async () => {
  const { read } = fixture([token(), page([site]), page([])])
  const [summary] = await read(config())
  assert.equal(summary.status, 'degraded')
  assert.match(summary.detail, /No devices observed/)
})

test('site summaries cannot collide with device IDs and labels redact credentials', async () => {
  const { read } = fixture([
    token(), page([{ siteId: 'aa-bb-cc-dd-ee-01', name: 'access-secret' }, { siteId: 'site', name: 'client-secret' }]),
    page([]), page([{ ...device, name: 'client-secret access-secret', model: 'client-id' }]),
  ])
  const services = await read(config())
  assert.equal(new Set(services.map(s => s.id)).size, services.length)
  assert.doesNotMatch(JSON.stringify(services), /access-secret|client-secret|client-id/)
})

test('token is reused until expiry and discarded after upstream authentication failure', async () => {
  let now = 0
  const settings = config()
  const { read, calls } = fixture([
    token(), page([]), page([]), token(), page([]), new Response('access-secret', { status: 401 }), token(), page([]),
  ], { now: () => now })
  await read(settings)
  await read(settings)
  assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  now = 7200000
  await read(settings)
  await assert.rejects(read(settings), { message: 'Omada authentication failed' })
  await read(settings)
  assert.equal(calls.filter(c => c.method === 'POST').length, 3)
})

test('credential rotation on an existing config invalidates the cached token', async () => {
  const settings = config()
  const { read, calls } = fixture([token(), page([]), token(), page([])])
  await read(settings)
  settings.clientSecret = 'rotated-secret'
  await read(settings)
  assert.equal(calls.filter(c => c.method === 'POST').length, 2)
})

test('upstream errors and invalid JSON are sanitized', async () => {
  for (const response of [
    new Response('client-secret access-secret', { status: 403 }),
    new Response('client-secret access-secret', { status: 500 }),
    Response.json({ errorCode: -1, msg: 'client-secret access-secret' }),
    new Response('client-secret access-secret'),
    new Response(null, { status: 302, headers: { Location: 'https://other.test' } }),
  ]) {
    const { read } = fixture([response])
    await assert.rejects(read(config()), error => /^Omada /.test(error.message) && !/secret/.test(error.message))
  }
  const { read } = fixture([() => { throw Error('client-secret access-secret') }])
  await assert.rejects(read(config()), { message: 'Omada unavailable' })
})

test('malformed, duplicate, oversized and incomplete inventories fail without returning partial state', async () => {
  for (const responses of [
    [json({ accessToken: '', expiresIn: 7200 })],
    [token(), json({ data: [], totalRows: '1' })],
    [token(), page([site], 17)],
    [token(), page([site, site])],
    [token(), page([{ ...site, siteId: '../escape' }])],
    [token(), page([site], 2), page([], 2)],
    [token(), page([site]), page([device, device])],
    [token(), page([site]), page([device], 201)],
    [token(), page([site]), page([{ ...device, mac: '../escape' }])],
    [token(), page([site]), page([device], 2), page([], 2)],
  ]) {
    const { read } = fixture(responses)
    await assert.rejects(read(config()), /Omada (invalid response|inventory limit exceeded)/)
  }
})

test('response size and deadline bound authentication, inventory and body reads', async () => {
  const { read } = fixture([new Response('x'.repeat(512 * 1024 + 1))])
  await assert.rejects(read(config()), { message: 'Omada response too large' })
  for (const stallAt of ['auth', 'inventory', 'body']) {
    let aborted = false
    const stalled = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
    })
    const responses = stallAt === 'auth' ? [stalled] : stallAt === 'inventory' ? [token(), stalled] : [
      (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => { aborted = true; controller.error(signal.reason) }, { once: true })
      } })),
    ]
    const { read: bounded } = fixture(responses, { timeoutMs: 10 })
    await assert.rejects(bounded(config()), { message: 'Omada timeout' })
    assert.equal(aborted, true)
  }
})
