import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from '../config.mjs'
import {createFridayServer} from '../http.mjs'
import {createActionAudit} from '../audit/action-audit.mjs'
import {createRepositorySettingsStore, ManagedRepositoryRegistry, readRegistryEntries, repositorySettingsView} from './managed-registry.mjs'

async function tempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-repo-settings-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  return root
}

async function checkout(root, name) {
  await mkdir(join(root, name, '.git'), {recursive: true})
  await writeFile(join(root, name, 'README.md'), `# ${name}\n`)
  return join(root, name)
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

async function fixture(t) {
  const root = await tempDir(t)
  const allowed = join(root, 'repositories')
  const friday = await checkout(allowed, 'friday')
  const registryPath = join(root, 'repositories.json')
  await writeFile(registryPath, JSON.stringify([
    {id: 'friday', name: 'Friday', path: friday, mode: 'development', remote: 'https://user:pw@github.com/StMedrano/Friday.git', exclude: ['data/**']},
    {id: 'old', name: 'Old', path: join(allowed, 'old'), mode: 'read-only', enabled: false},
  ]))
  return {root, allowed, friday, registryPath, storePath: join(root, 'data', 'repositories.json')}
}

test('registry file entries are the baseline, including disabled ones, with credentials stripped from remotes', async t => {
  const {registryPath, friday, allowed} = await fixture(t)
  assert.deepEqual(await readRegistryEntries(registryPath), [
    {id: 'friday', name: 'Friday', path: friday, remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main', mode: 'development', enabled: true, exclude: ['data/**']},
    {id: 'old', name: 'Old', path: join(allowed, 'old'), defaultBranch: 'main', mode: 'read-only', enabled: false, exclude: []},
  ])
  assert.deepEqual(await readRegistryEntries(join(allowed, 'missing.json')), [])
})

test('store creates, edits and deletes repositories inside the allowed roots, seeding from the registry file', async t => {
  const {allowed, friday, registryPath, storePath} = await fixture(t)
  const docs = await checkout(allowed, 'docs')
  const baseline = await readRegistryEntries(registryPath)
  const store = await createRepositorySettingsStore({path: storePath, allowedRoots: [allowed]})
  assert.equal(store.get(), null)

  const created = await store.create({name: 'Docs Site', path: docs, defaultBranch: 'trunk', exclude: ['drafts/**']}, baseline)
  assert.deepEqual(created, {id: 'docs-site', name: 'Docs Site', path: docs, defaultBranch: 'trunk', mode: 'read-only', enabled: true, exclude: ['drafts/**']})
  assert.deepEqual(store.get().map(entry => entry.id), ['friday', 'old', 'docs-site'])
  await assert.rejects(store.create({id: 'friday', name: 'Dup', path: docs}, baseline), {code: 'repository-exists'})

  // An existing non-read-only mode is kept, but the API cannot grant one.
  const edited = await store.update('friday', {name: 'Friday UI', path: friday, mode: 'development', enabled: false}, baseline)
  assert.equal(edited.mode, 'development')
  assert.equal(edited.enabled, false)
  await assert.rejects(store.update('docs-site', {name: 'Docs', path: docs, mode: 'pr-enabled'}, baseline), {code: 'invalid-repository'})
  await assert.rejects(store.create({name: 'Dev', path: docs, mode: 'development'}, baseline), {code: 'invalid-repository'})
  await assert.rejects(store.update('missing', {name: 'x', path: docs}, baseline), {code: 'repository-not-found'})
  await assert.rejects(store.update('friday', {id: 'renamed', name: 'x', path: friday}, baseline), {code: 'invalid-repository'})

  await store.remove('old', baseline)
  await assert.rejects(store.remove('old', baseline), {code: 'repository-not-found'})
  const saved = JSON.parse(await readFile(storePath, 'utf8'))
  assert.deepEqual(saved.repositories.map(entry => [entry.id, entry.name, entry.enabled]), [['friday', 'Friday UI', false], ['docs-site', 'Docs Site', true]])
  assert.deepEqual((await createRepositorySettingsStore({path: storePath, allowedRoots: [allowed]})).get().map(entry => entry.id), ['friday', 'docs-site'])

  await writeFile(storePath, '{not json')
  assert.equal((await createRepositorySettingsStore({path: storePath, allowedRoots: [allowed]})).get(), null)
})

test('store refuses paths outside the allowed roots, escaping symlinks, non-checkouts and unsafe fields', async t => {
  const {root, allowed} = await fixture(t)
  const outside = await checkout(root, 'outside')
  await symlink(outside, join(allowed, 'sneaky'))
  await mkdir(join(allowed, 'plain'), {recursive: true})
  const store = await createRepositorySettingsStore({path: join(root, 'store.json'), allowedRoots: [allowed]})
  await assert.rejects(store.create({name: 'Out', path: outside}, []), {code: 'repository-path-not-allowed'})
  await assert.rejects(store.create({name: 'Dots', path: join(allowed, '..', 'outside')}, []), {code: 'repository-path-not-allowed'})
  await assert.rejects(store.create({name: 'Root', path: allowed}, []), {code: 'repository-path-not-allowed'})
  await assert.rejects(store.create({name: 'Link', path: join(allowed, 'sneaky')}, []), {code: 'repository-path-not-allowed'})
  await assert.rejects(store.create({name: 'Plain', path: join(allowed, 'plain')}, []), {code: 'repository-not-git'})
  await assert.rejects(store.create({name: 'Gone', path: join(allowed, 'gone')}, []), {code: 'repository-not-git'})
  for (const bad of [
    null, [], {name: '', path: join(allowed, 'friday')}, {name: 'x'}, {name: 'x', path: 'relative/path'},
    {name: 'x', path: join(allowed, 'friday'), extra: 1}, {name: 'x', path: join(allowed, 'friday'), exclude: ['/abs']},
    {name: 'x', path: join(allowed, 'friday'), remote: 'file:///etc/passwd'}, {id: 'Bad Id', name: 'x', path: join(allowed, 'friday')},
    {name: 'x', path: join(allowed, 'friday'), enabled: 'yes'}, {name: 'x', path: join(allowed, 'friday'), defaultBranch: 'a b'},
  ]) await assert.rejects(store.create(bad, []), {code: 'invalid-repository'}, JSON.stringify(bad))
})

test('managed registry serves stored repositories and falls back to the registry file', async t => {
  const {allowed, friday, registryPath, storePath} = await fixture(t)
  const store = await createRepositorySettingsStore({path: storePath, allowedRoots: [allowed]})
  const registry = new ManagedRepositoryRegistry({registryPath, store})
  assert.deepEqual((await registry.list()).map(entry => entry.id), ['friday'])
  await store.update('friday', {name: 'Friday', path: friday, mode: 'development', enabled: false}, await readRegistryEntries(registryPath))
  assert.deepEqual(await registry.list(), [])
  await store.update('friday', {name: 'Friday', path: friday, mode: 'development'}, [])
  assert.equal((await registry.readFile('friday', 'README.md')), '# friday\n')
  const view = await repositorySettingsView({registryPath, allowedRoots: [allowed]}, store.get())
  assert.equal(view.managed, true)
  assert.deepEqual(view.allowedRoots, [allowed])
  assert.deepEqual(view.repositories.map(entry => entry.id), ['friday', 'old'])
})

test('repository settings API: viewers read, operators create/edit/delete with audit, unsafe requests are refused', async t => {
  const {root, allowed, registryPath, storePath} = await fixture(t)
  const docs = await checkout(allowed, 'docs')
  const repositorySettings = await createRepositorySettingsStore({path: storePath, allowedRoots: [allowed]})
  const repositoryRegistry = new ManagedRepositoryRegistry({registryPath, store: repositorySettings})
  const actionAudit = await createActionAudit({directory: join(root, 'audit')})
  const config = {...getConfig({FRIDAY_MODE: 'live'}), repositories: {registryPath, allowedRoots: [allowed]}}
  const body = JSON.stringify({name: 'Docs', path: docs})

  await withServer({config, accessGateImpl: operatorGate, actionAudit, repositoryRegistry, repositorySettings}, async base => {
    const initial = await (await fetch(base + '/api/settings/repositories')).json()
    assert.equal(initial.managed, false)
    assert.deepEqual(initial.repositories.map(entry => entry.id), ['friday', 'old'])

    assert.equal((await fetch(base + '/api/settings/repositories', {method: 'POST', headers: {'content-type': 'text/plain'}, body})).status, 415)
    assert.equal((await fetch(base + '/api/settings/repositories', {method: 'POST', headers: {...json, 'sec-fetch-site': 'cross-site'}, body})).status, 403)
    assert.equal((await fetch(base + '/api/settings/repositories', {method: 'POST', headers: json, body: JSON.stringify({name: 'Etc', path: '/etc'})})).status, 400)

    const created = await fetch(base + '/api/settings/repositories', {method: 'POST', headers: json, body})
    assert.equal(created.status, 201)
    assert.equal((await created.json()).repository.id, 'docs')
    assert.equal((await fetch(base + '/api/settings/repositories', {method: 'POST', headers: json, body})).status, 409)
    assert.deepEqual((await (await fetch(base + '/api/repositories')).json()).map(entry => entry.id), ['friday', 'docs'])

    const edited = await fetch(base + '/api/settings/repositories/docs', {method: 'PUT', headers: json, body: JSON.stringify({name: 'Docs site', path: docs, defaultBranch: 'trunk'})})
    assert.equal(edited.status, 200)
    assert.equal((await edited.json()).repository.defaultBranch, 'trunk')
    assert.equal((await fetch(base + '/api/settings/repositories/nope', {method: 'PUT', headers: json, body})).status, 404)

    const removed = await fetch(base + '/api/settings/repositories/old', {method: 'DELETE'})
    assert.equal(removed.status, 200)
    assert.deepEqual((await removed.json()).repositories.map(entry => entry.id), ['friday', 'docs'])

    const events = await (await fetch(base + '/api/audit/events?limit=50')).json()
    const outcomes = action => events.events.filter(event => event.action === action && event.phase !== 'requested').map(event => event.phase).sort()
    assert.deepEqual(outcomes('settings.repositories.create'), ['failed', 'failed', 'succeeded'])
    assert.deepEqual(outcomes('settings.repositories.update'), ['failed', 'succeeded'])
    assert.deepEqual(outcomes('settings.repositories.delete'), ['succeeded'])
  })

  await withServer({config, accessGateImpl: viewerGate, repositoryRegistry, repositorySettings}, async base => {
    assert.equal((await fetch(base + '/api/settings/repositories')).status, 200)
    assert.equal((await fetch(base + '/api/settings/repositories', {method: 'POST', headers: json, body})).status, 403)
    assert.equal((await fetch(base + '/api/settings/repositories/docs', {method: 'DELETE'})).status, 403)
  })
  await withServer({config: getConfig({}), accessGateImpl: operatorGate}, async base => {
    assert.equal((await fetch(base + '/api/settings/repositories')).status, 503)
  })
})
