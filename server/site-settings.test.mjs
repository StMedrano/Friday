import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from './config.mjs'
import {createFridayServer} from './http.mjs'
import {createActionAudit} from './audit/action-audit.mjs'
import {buildOverview} from './overview.mjs'
import {applySiteSettings, createSiteSettingsStore, deriveSites, validateSiteSettings} from './site-settings.mjs'

async function tempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-site-settings-'))
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

test('validation accepts declared sites and source labels and rejects unsafe input', () => {
  assert.deepEqual(validateSiteSettings({sites: [{name: 'Home'}, 'Remote Office'], sources: {proxmox: 'Home', endpoints: 'Remote Office', docker: null}}), {
    sites: [{id: 'home', name: 'Home'}, {id: 'remote-office', name: 'Remote Office'}],
    sources: {proxmox: 'Home', endpoints: 'Remote Office'},
  })
  assert.deepEqual(validateSiteSettings({sources: {proxmox: ' Home '}}), {sites: [], sources: {proxmox: 'Home'}})
  for (const bad of [
    null, [], {extra: 1}, {sites: 'Home'}, {sites: [{name: '<script>'}]}, {sites: ['Home', 'home']},
    {sites: Array.from({length: 9}, (_, i) => `Site ${i}`)}, {sources: {omada: 'Home'}},
    {sites: ['Home'], sources: {proxmox: 'Elsewhere'}}, {sources: {proxmox: 'x'.repeat(49)}},
  ]) assert.throws(() => validateSiteSettings(bad), {code: 'invalid-site-settings'}, JSON.stringify(bad))
})

test('stored labels override environment defaults and declared sites derive status from members', async () => {
  const config = applySiteSettings(getConfig({FRIDAY_PROXMOX_SITE: 'Env Site'}), {sites: [{id: 'home', name: 'Home'}], sources: {proxmox: 'Home'}})
  assert.equal(config.proxmox.site, 'Home')
  assert.equal(config.docker.site, 'Site A')
  assert.deepEqual(deriveSites(config.declaredSites, [
    {site: 'Home', status: 'online'}, {site: 'Home', status: 'offline'}, {site: 'Elsewhere', status: 'online'},
  ]), [{id: 'home', name: 'Home', location: 'Declared in Friday settings', status: 'degraded', devicesOnline: 1, devicesTotal: 2}])
  assert.equal(deriveSites([{id: 'empty', name: 'Empty'}], [])[0].status, 'maintenance')

  const overview = await buildOverview({...getConfig({FRIDAY_MODE: 'live'}), declaredSites: [{id: 'home', name: 'Home'}]}, {
    getProxmoxServices: async () => [{id: 'p1', name: 'vm', site: 'Home', status: 'online'}],
    getDockerServices: async () => [], getVm100ObserverServices: async () => [], getEndpointServices: async () => [],
  })
  assert.deepEqual(overview.sites.map(site => [site.name, site.status, site.devicesTotal]), [['Home', 'online', 1]])
})

test('store persists atomically, reloads, and ignores an unreadable file', async t => {
  const root = await tempDir(t)
  const path = join(root, 'site-settings.json')
  const store = await createSiteSettingsStore({path})
  assert.deepEqual(store.get(), {sources: {}, sites: []})
  await store.save({sites: ['Home'], sources: {proxmox: 'Home'}})
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {sources: {proxmox: 'Home'}, sites: [{id: 'home', name: 'Home'}]})
  assert.deepEqual((await createSiteSettingsStore({path})).get().sources, {proxmox: 'Home'})
  await writeFile(path, '{not json')
  assert.deepEqual((await createSiteSettingsStore({path})).get(), {sources: {}, sites: []})
})

test('site settings API lets operators save with audit and denies viewers and cross-site writes', async t => {
  const root = await tempDir(t)
  const siteSettings = await createSiteSettingsStore({path: join(root, 'site-settings.json')})
  const actionAudit = await createActionAudit({directory: join(root, 'audit')})
  const config = getConfig({FRIDAY_MODE: 'live'})
  const body = JSON.stringify({sites: ['Home'], sources: {proxmox: 'Home', 'vm100-observer': 'Home'}})

  await withServer({config, accessGateImpl: operatorGate, actionAudit, siteSettings}, async base => {
    const initial = await (await fetch(base + '/api/settings/sites')).json()
    assert.deepEqual(initial.sites, [])
    assert.equal(initial.sources.find(source => source.id === 'proxmox').defaultSite, 'Site A')

    assert.equal((await fetch(base + '/api/settings/sites', {method: 'PUT', headers: {'content-type': 'text/plain'}, body})).status, 415)
    assert.equal((await fetch(base + '/api/settings/sites', {method: 'PUT', headers: {...json, 'sec-fetch-site': 'cross-site'}, body})).status, 403)
    const invalid = await fetch(base + '/api/settings/sites', {method: 'PUT', headers: json, body: '{"sites":["<x>"]}'})
    assert.equal(invalid.status, 400)

    const saved = await fetch(base + '/api/settings/sites', {method: 'PUT', headers: json, body})
    assert.equal(saved.status, 200)
    const view = await saved.json()
    assert.deepEqual(view.sites, [{id: 'home', name: 'Home'}])
    assert.equal(view.sources.find(source => source.id === 'proxmox').site, 'Home')

    const events = await (await fetch(base + '/api/audit/events?limit=10')).json()
    const actions = events.events.filter(event => event.action === 'settings.sites.update').map(event => event.phase)
    assert.deepEqual(actions.sort(), ['failed', 'requested', 'requested', 'succeeded'])
  })

  await withServer({config, accessGateImpl: viewerGate, siteSettings}, async base => {
    assert.equal((await fetch(base + '/api/settings/sites')).status, 200)
    assert.equal((await fetch(base + '/api/settings/sites', {method: 'PUT', headers: json, body})).status, 403)
  })
  assert.deepEqual(siteSettings.get().sources, {proxmox: 'Home', 'vm100-observer': 'Home'})
})

test('site settings API reports unavailable when no store is configured', async () => {
  await withServer({config: getConfig({}), accessGateImpl: operatorGate}, async base => {
    assert.equal((await fetch(base + '/api/settings/sites')).status, 503)
  })
})
