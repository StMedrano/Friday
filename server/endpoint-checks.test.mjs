import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from './config.mjs'
import {createFridayServer} from './http.mjs'
import {createActionAudit} from './audit/action-audit.mjs'
import {applyEndpointChecks, createEndpointCheckStore, environmentEndpointChecks, endpointChecksView} from './endpoint-checks.mjs'

async function tempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-endpoint-checks-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  return root
}

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

const json = {'content-type': 'application/json'}
const operatorGate = async () => ({status: 200, identity: {subject: 'op-sub', email: 'op@example.com'}})
const viewerGate = async (_request, operatorOnly) => operatorOnly ? {status: 403} : {status: 200, identity: {subject: 'viewer'}}
const envChecks = JSON.stringify([{id: 'nas', name: 'NAS', site: 'Home', url: 'http://10.0.0.5/'}])

test('environment checks are the baseline, including legacy URLs with the endpoints site label', () => {
  assert.deepEqual(environmentEndpointChecks(getConfig({FRIDAY_ENDPOINT_CHECKS_JSON: envChecks}).endpoints),
    [{id: 'nas', name: 'NAS', site: 'Home', url: 'http://10.0.0.5/', expectedStatuses: [200]}])
  assert.deepEqual(environmentEndpointChecks(getConfig({FRIDAY_ENDPOINT_URLS: 'https://a.example/x', FRIDAY_ENDPOINTS_SITE: 'Lab'}).endpoints),
    [{id: '0', name: 'a.example', site: 'Lab', url: 'https://a.example/x', expectedStatuses: null}])
  assert.deepEqual(environmentEndpointChecks(getConfig({FRIDAY_ENDPOINT_URLS: 'bad url'}).endpoints), [])
})

test('store creates, edits and deletes checks, seeding from the environment on first write', async t => {
  const root = await tempDir(t)
  const path = join(root, 'endpoint-checks.json')
  const baseline = environmentEndpointChecks(getConfig({FRIDAY_ENDPOINT_CHECKS_JSON: envChecks}).endpoints)
  const store = await createEndpointCheckStore({path})
  assert.equal(store.get(), null)

  const created = await store.create({name: 'Grafana UI', site: 'Home', url: 'https://grafana.example/login', expectedStatuses: [200, 302]}, baseline)
  assert.deepEqual(created, {id: 'grafana-ui', name: 'Grafana UI', site: 'Home', url: 'https://grafana.example/login', expectedStatuses: [200, 302]})
  assert.deepEqual(store.get().map(check => check.id), ['nas', 'grafana-ui'])

  await assert.rejects(store.create({id: 'nas', name: 'Dup', site: 'Home', url: 'http://x/'}, baseline), {code: 'endpoint-check-exists'})
  const edited = await store.update('nas', {name: 'NAS web', site: 'Home', url: 'http://10.0.0.5:5000/'}, baseline)
  assert.deepEqual(edited, {id: 'nas', name: 'NAS web', site: 'Home', url: 'http://10.0.0.5:5000/', expectedStatuses: [200]})
  await assert.rejects(store.update('missing', {name: 'x', site: 'Home', url: 'http://x/'}, baseline), {code: 'endpoint-check-not-found'})
  await assert.rejects(store.update('nas', {id: 'other', name: 'x', site: 'Home', url: 'http://x/'}, baseline), {code: 'invalid-endpoint-check'})

  await store.remove('grafana-ui', baseline)
  await assert.rejects(store.remove('grafana-ui', baseline), {code: 'endpoint-check-not-found'})
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {checks: [{id: 'nas', name: 'NAS web', site: 'Home', url: 'http://10.0.0.5:5000/', expectedStatuses: [200]}]})
  assert.deepEqual((await createEndpointCheckStore({path})).get().map(check => check.name), ['NAS web'])

  await writeFile(path, '{not json')
  assert.equal((await createEndpointCheckStore({path})).get(), null)
})

test('store rejects unsafe or oversized checks', async t => {
  const store = await createEndpointCheckStore({path: join(await tempDir(t), 'checks.json')})
  for (const bad of [
    null, [], {name: 'x', site: 'Home', url: 'ftp://x/'}, {name: 'x', site: 'Home', url: 'http://u:p@x/'},
    {name: 'x', site: 'Home', url: 'http://x/?token=1'}, {name: '', site: 'Home', url: 'http://x/'},
    {name: 'x', url: 'http://x/'}, {name: 'x', site: 'Home', url: 'http://x/', expectedStatuses: [99]},
    {name: 'x', site: 'Home', url: 'http://x/', extra: true}, {id: 'Bad_ID', name: 'x', site: 'Home', url: 'http://x/'},
  ]) await assert.rejects(store.create(bad, []), {code: 'invalid-endpoint-check'}, JSON.stringify(bad))
  const full = Array.from({length: 16}, (_, i) => ({id: `c${i}`, name: `C${i}`, site: 'Home', url: `http://h${i}/`, expectedStatuses: [200]}))
  await assert.rejects(store.create({name: 'one more', site: 'Home', url: 'http://x/'}, full), {code: 'endpoint-check-limit'})
})

test('stored checks replace environment checks for monitoring', () => {
  const config = getConfig({FRIDAY_ENDPOINTS_ENABLED: 'true', FRIDAY_ENDPOINT_URLS: 'https://a.example/'})
  assert.equal(applyEndpointChecks(config, null), config)
  const next = applyEndpointChecks(config, [{id: 'b', name: 'B', site: 'Home', url: 'https://b.example/', expectedStatuses: [200]}])
  assert.deepEqual(next.endpoints.checks.map(check => check.id), ['b'])
  assert.deepEqual(next.endpoints.urls, [])
  assert.equal(next.endpoints.enabled, true)
  assert.deepEqual(applyEndpointChecks(config, []).endpoints.urls, [])
  assert.deepEqual(endpointChecksView(config, null), {managed: false, enabled: true, limit: 16, checks: [{id: '0', name: 'a.example', site: 'Site A', url: 'https://a.example/', expectedStatuses: null}]})
})

test('endpoint checks API: viewers read, operators create/edit/delete with audit, unsafe requests are refused', async t => {
  const root = await tempDir(t)
  const endpointChecks = await createEndpointCheckStore({path: join(root, 'endpoint-checks.json')})
  const actionAudit = await createActionAudit({directory: join(root, 'audit')})
  const config = getConfig({FRIDAY_MODE: 'live', FRIDAY_ENDPOINT_CHECKS_JSON: envChecks})
  const body = JSON.stringify({name: 'Router', site: 'Home', url: 'http://10.0.0.1/'})

  await withServer({config, accessGateImpl: operatorGate, actionAudit, endpointChecks}, async base => {
    const initial = await (await fetch(base + '/api/settings/endpoints')).json()
    assert.equal(initial.managed, false)
    assert.deepEqual(initial.checks.map(check => check.id), ['nas'])

    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: {'content-type': 'text/plain'}, body})).status, 415)
    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: {...json, 'sec-fetch-site': 'cross-site'}, body})).status, 403)
    assert.equal((await fetch(base + '/api/settings/endpoints/nas', {method: 'DELETE', headers: {'sec-fetch-site': 'cross-site'}})).status, 403)
    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body: '{"name":"x"}'})).status, 400)
    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body: '{'})).status, 400)

    const created = await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body})
    assert.equal(created.status, 201)
    assert.deepEqual((await created.json()).check, {id: 'router', name: 'Router', site: 'Home', url: 'http://10.0.0.1/', expectedStatuses: [200]})
    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body})).status, 409)

    const edited = await fetch(base + '/api/settings/endpoints/router', {method: 'PUT', headers: json, body: JSON.stringify({name: 'Edge router', site: 'Home', url: 'https://10.0.0.1/', expectedStatuses: [200, 401]})})
    assert.equal(edited.status, 200)
    assert.equal((await edited.json()).check.name, 'Edge router')
    assert.equal((await fetch(base + '/api/settings/endpoints/nope', {method: 'PUT', headers: json, body})).status, 404)
    assert.equal((await fetch(base + '/api/settings/endpoints/Bad%20Id', {method: 'DELETE'})).status, 404)

    const removed = await fetch(base + '/api/settings/endpoints/nas', {method: 'DELETE'})
    assert.equal(removed.status, 200)
    const view = await removed.json()
    assert.equal(view.managed, true)
    assert.deepEqual(view.checks.map(check => check.id), ['router'])

    const events = await (await fetch(base + '/api/audit/events?limit=50')).json()
    const outcomes = action => events.events.filter(event => event.action === action && event.phase !== 'requested').map(event => event.phase).sort()
    assert.deepEqual(outcomes('settings.endpoints.create'), ['failed', 'failed', 'failed', 'succeeded'])
    assert.deepEqual(outcomes('settings.endpoints.update'), ['failed', 'succeeded'])
    assert.deepEqual(outcomes('settings.endpoints.delete'), ['succeeded'])
    assert.ok(events.events.some(event => event.action === 'settings.endpoints.update' && event.target === 'router'))
  })

  await withServer({config, accessGateImpl: viewerGate, endpointChecks}, async base => {
    assert.equal((await fetch(base + '/api/settings/endpoints')).status, 200)
    assert.equal((await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body})).status, 403)
    assert.equal((await fetch(base + '/api/settings/endpoints/router', {method: 'PUT', headers: json, body})).status, 403)
    assert.equal((await fetch(base + '/api/settings/endpoints/router', {method: 'DELETE'})).status, 403)
  })
  assert.deepEqual(endpointChecks.get().map(check => check.id), ['router'])
})

test('endpoint checks API reports unavailable without a store and overview uses stored checks', async () => {
  await withServer({config: getConfig({}), accessGateImpl: operatorGate}, async base => {
    assert.equal((await fetch(base + '/api/settings/endpoints')).status, 503)
  })
  let seen = null
  const endpointChecks = {get: () => [{id: 'b', name: 'B', site: 'Home', url: 'https://b.example/', expectedStatuses: [200]}]}
  await withServer({config: getConfig({}), endpointChecks, buildOverviewImpl: async config => { seen = config; return {services: []} }}, async base => {
    assert.equal((await fetch(base + '/api/overview')).status, 200)
  })
  assert.deepEqual(seen.endpoints.checks.map(check => check.id), ['b'])
})

test('first write seeds legacy URL checks with the operator site label, and delete retires the check incidents', async t => {
  const root = await tempDir(t)
  const endpointChecks = await createEndpointCheckStore({path: join(root, 'endpoint-checks.json')})
  const siteSettings = {get: () => ({sites: [{id: 'remote', name: 'Remote'}], sources: {endpoints: 'Remote'}})}
  const retired = []
  const monitoringRuntime = {getOverview: () => null, retireService: async (id, reason) => { retired.push([id, reason]); return true }}
  const config = getConfig({FRIDAY_ENDPOINT_URLS: 'https://a.example/,https://b.example/'})

  await withServer({config, accessGateImpl: operatorGate, endpointChecks, siteSettings, monitoringRuntime}, async base => {
    const initial = await (await fetch(base + '/api/settings/endpoints')).json()
    assert.deepEqual(initial.checks.map(check => check.site), ['Remote', 'Remote'])
    const removed = await fetch(base + '/api/settings/endpoints/0', {method: 'DELETE'})
    assert.equal(removed.status, 200)
    assert.deepEqual((await removed.json()).checks.map(check => [check.id, check.site]), [['1', 'Remote']])
  })
  assert.deepEqual(retired, [['endpoint-0', 'endpoint check deleted']])
})

test('settings posture reports the managed endpoint checks, not the environment ones', async t => {
  const endpointChecks = await createEndpointCheckStore({path: join(await tempDir(t), 'endpoint-checks.json')})
  const config = getConfig({FRIDAY_ENDPOINTS_ENABLED: 'true'})
  await withServer({config, accessGateImpl: operatorGate, endpointChecks}, async base => {
    const endpoints = async () => (await (await fetch(base + '/api/settings')).json()).integrations.find(item => item.id === 'endpoints')
    assert.equal((await endpoints()).checks, 0)
    await fetch(base + '/api/settings/endpoints', {method: 'POST', headers: json, body: JSON.stringify({name: 'Router', site: 'Home', url: 'http://10.0.0.1/'})})
    const managed = await endpoints()
    assert.equal(managed.checks, 1)
    assert.equal(managed.configured, true)
  })
})
