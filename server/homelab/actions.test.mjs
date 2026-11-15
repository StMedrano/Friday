import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDockerExecutorClient, createHomelabActions, createProxmoxPowerClient, loadHomelabCatalog, parseHomelabCatalog } from './actions.mjs'

const catalogFile = () => ({ schemaVersion: 1, actions: [
  { id: 'development', name: 'development', node: 'home', guestType: 'qemu', vmid: 140, operations: ['start', 'shutdown', 'reboot'] },
  { id: 'ollama', name: 'ollama', node: 'home', guestType: 'lxc', vmid: 108, operations: ['reboot'], description: 'Local models' },
] })

function fakeClient(states = { 140: 'running', 108: 'running' }) {
  const calls = []
  return {
    calls,
    states,
    client: {
      ready: true,
      async status(guest) { calls.push(['status', guest.vmid]); return { status: states[guest.vmid] ?? 'unknown' } },
      async act(guest, operation) { calls.push(['act', guest.vmid, operation]); return { upid: `UPID:home:0001:${operation}:${guest.vmid}:friday-power@pve!actions:` } },
    },
  }
}

async function setup({ mode = 'dry-run', gate = true, states, now = () => Date.parse('2026-11-15T20:00:00Z') } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-homelab-'))
  const fake = fakeClient(states)
  const actions = await createHomelabActions({
    enabled: true, mode, catalog: parseHomelabCatalog(catalogFile()), client: fake.client, path: join(dir, 'runs.json'),
    automationGate: { isAllowed: () => gate }, now,
  })
  return { dir, fake, actions }
}

test('the catalog accepts only listed guests with start, shutdown or reboot', () => {
  const parsed = parseHomelabCatalog(catalogFile())
  assert.equal(parsed.length, 2)
  assert.deepEqual(parsed[0].operations, ['start', 'shutdown', 'reboot'])
  const bad = (change) => { const file = catalogFile(); change(file.actions[0]); assert.throws(() => parseHomelabCatalog(file), /invalid-homelab-catalog/) }
  bad((entry) => { entry.operations = ['stop'] })
  bad((entry) => { entry.operations = ['destroy'] })
  bad((entry) => { entry.operations = [] })
  bad((entry) => { entry.operations = ['start', 'start'] })
  bad((entry) => { entry.guestType = 'node' })
  bad((entry) => { entry.vmid = '140' })
  bad((entry) => { entry.node = '../cluster' })
  bad((entry) => { entry.command = 'qm destroy 140' })
  bad((entry) => { entry.id = 'Development' })
  const dupe = catalogFile(); dupe.actions[1].vmid = 140
  assert.throws(() => parseHomelabCatalog(dupe), /invalid-homelab-catalog/)
  assert.throws(() => parseHomelabCatalog({ schemaVersion: 2, actions: [] }), /invalid-homelab-catalog/)
})

test('the catalog file must be owner-written: symlinks and loose permissions keep it off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-homelab-cat-'))
  const path = join(dir, 'homelab-actions.json')
  await writeFile(path, JSON.stringify(catalogFile()), { mode: 0o600 })
  assert.equal((await loadHomelabCatalog(path)).length, 2)
  await chmod(path, 0o666)
  assert.equal(await loadHomelabCatalog(path), null)
  await chmod(path, 0o644)
  const link = join(dir, 'link.json')
  await symlink(path, link)
  assert.equal(await loadHomelabCatalog(link), null)
  assert.equal(await loadHomelabCatalog(join(dir, 'missing.json')), null)
  assert.equal(await loadHomelabCatalog(''), null)
})

test('the Proxmox client only reads status and posts the three power operations to catalog paths', async () => {
  const calls = []
  const client = createProxmoxPowerClient({ baseUrl: 'https://10.1.0.2:8006', tokenId: 'friday-power@pve!actions', tokenSecret: 'secret',
    requestImpl: async (_config, method, path) => { calls.push([method, path]); return method === 'GET' ? { status: 'running' } : 'UPID:home:00001:qmshutdown:140:root@pam:' } })
  assert.equal(client.ready, true)
  const guest = { node: 'home', guestType: 'qemu', vmid: 140 }
  assert.deepEqual(await client.status(guest), { status: 'running' })
  assert.deepEqual(await client.act(guest, 'shutdown'), { upid: 'UPID:home:00001:qmshutdown:140:root@pam:' })
  await assert.rejects(client.act(guest, 'stop'), /operation-not-allowed/)
  assert.deepEqual(calls, [['GET', '/nodes/home/qemu/140/status/current'], ['POST', '/nodes/home/qemu/140/status/shutdown']])
  assert.equal(createProxmoxPowerClient({ baseUrl: 'http://10.1.0.2:8006', tokenId: 'a', tokenSecret: 'b' }).ready, false)
  assert.equal(createProxmoxPowerClient({ baseUrl: 'https://10.1.0.2:8006', tokenId: '', tokenSecret: 'b' }).ready, false)
})

test('stays off without a ready client, a path, or a gate in execute mode', async () => {
  const { client } = fakeClient()
  assert.equal((await createHomelabActions({ enabled: true, catalog: [], client, path: '' })).enabled, false)
  assert.equal((await createHomelabActions({ enabled: false, catalog: [], client, path: '/tmp/x.json' })).enabled, false)
  assert.equal((await createHomelabActions({ enabled: true, catalog: [], client: { ...client, ready: false }, path: '/tmp/x.json' })).enabled, false)
  assert.equal((await createHomelabActions({ enabled: true, mode: 'execute', catalog: [], client, path: '/tmp/x.json' })).enabled, false)
})

test('list shows each listed guest with its live state', async () => {
  const { actions } = await setup({ states: { 140: 'stopped', 108: 'running' } })
  const view = await actions.list()
  assert.equal(view.mode, 'dry-run')
  assert.deepEqual(view.actions.map((item) => [item.id, item.status, item.operations]), [
    ['development', 'stopped', ['start', 'shutdown', 'reboot']], ['ollama', 'running', ['reboot']]])
})

test('preview reads live state and changes nothing; unlisted operations are refused', async () => {
  const { actions, fake } = await setup()
  const preview = await actions.preview({ actionId: 'development', operation: 'shutdown', requestedBy: 'owner@example.com' })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.preview.allowed, true)
  assert.match(preview.body.preview.summary, /VM 140 development is running/)
  assert.equal(preview.body.preview.confirmText, 'development')
  assert.equal(preview.body.execution.performed, false)
  assert.equal(fake.calls.some(([kind]) => kind === 'act'), false)
  assert.equal((await actions.preview({ actionId: 'ollama', operation: 'shutdown' })).status, 403)
  assert.equal((await actions.preview({ actionId: 'nope', operation: 'start' })).status, 404)
  const noop = await actions.preview({ actionId: 'development', operation: 'start' })
  assert.equal(noop.body.preview.allowed, false)
  assert.equal(noop.body.preview.planId, undefined)
})

test('dry-run approval records what would run and never calls Proxmox to act', async () => {
  const { actions, fake, dir } = await setup()
  const { body } = await actions.preview({ actionId: 'development', operation: 'reboot', requestedBy: 'owner@example.com' })
  const result = await actions.run({ planId: body.preview.planId, confirm: 'development', requestedBy: 'owner@example.com' })
  assert.equal(result.status, 200)
  assert.equal(result.body.run.state, 'dry-run')
  assert.equal(result.body.execution.performed, false)
  assert.equal(fake.calls.some(([kind]) => kind === 'act'), false)
  const stored = JSON.parse(await readFile(join(dir, 'runs.json'), 'utf8'))
  assert.equal(stored.runs[0].state, 'dry-run')
  assert.equal(stored.runs[0].requestedBy, 'owner@example.com')
  // A preview approves one run only.
  assert.equal((await actions.run({ planId: body.preview.planId, confirm: 'development', requestedBy: 'owner@example.com' })).status, 409)
})

test('approval needs the typed name, the same operator, and a fresh preview', async () => {
  let clock = Date.parse('2026-11-15T20:00:00Z')
  const { actions } = await setup({ now: () => clock })
  const ask = async () => (await actions.preview({ actionId: 'development', operation: 'reboot', requestedBy: 'owner@example.com' })).body.preview.planId
  const planId = await ask()
  assert.equal((await actions.run({ planId, confirm: 'Development', requestedBy: 'owner@example.com' })).body.error, 'homelab-confirm-mismatch')
  assert.equal((await actions.run({ planId, confirm: 'development', requestedBy: 'someone@example.com' })).body.error, 'homelab-preview-not-yours')
  clock += 5 * 60 * 1000
  assert.equal((await actions.run({ planId, confirm: 'development', requestedBy: 'owner@example.com' })).body.error, 'homelab-preview-expired')
  assert.equal((await actions.run({ planId: 'made-up', confirm: 'development', requestedBy: 'owner@example.com' })).body.error, 'homelab-preview-expired')
})

test('execute mode acts once, only while the gate is armed and the guest is still in the needed state', async () => {
  const { actions, fake, dir } = await setup({ mode: 'execute' })
  const planId = (await actions.preview({ actionId: 'development', operation: 'shutdown', requestedBy: 'owner@example.com' })).body.preview.planId
  const result = await actions.run({ planId, confirm: 'development', requestedBy: 'owner@example.com' })
  assert.equal(result.status, 200)
  assert.equal(result.body.run.state, 'submitted')
  assert.equal(result.body.execution.performed, true)
  assert.deepEqual(fake.calls.filter(([kind]) => kind === 'act'), [['act', 140, 'shutdown']])
  const stored = JSON.parse(await readFile(join(dir, 'runs.json'), 'utf8'))
  assert.equal(stored.runs[0].state, 'submitted')
  assert.match(stored.runs[0].upid, /friday-power@pve!actions:$/)

  // State drift between preview and approval stops the run.
  const second = await actions.preview({ actionId: 'ollama', operation: 'reboot', requestedBy: 'owner@example.com' })
  fake.states[108] = 'stopped'
  const drift = await actions.run({ planId: second.body.preview.planId, confirm: 'ollama', requestedBy: 'owner@example.com' })
  assert.equal(drift.status, 409)
  assert.equal(drift.body.error, 'homelab-state-changed')
  assert.equal(fake.calls.filter(([kind]) => kind === 'act').length, 1)
})

test('execute mode refuses while the automation gate is closed', async () => {
  const { actions, fake } = await setup({ mode: 'execute', gate: false })
  const planId = (await actions.preview({ actionId: 'development', operation: 'reboot', requestedBy: 'owner@example.com' })).body.preview.planId
  const result = await actions.run({ planId, confirm: 'development', requestedBy: 'owner@example.com' })
  assert.equal(result.status, 423)
  assert.equal(result.body.error, 'automation-gate-closed')
  assert.equal(fake.calls.some(([kind]) => kind === 'act'), false)
})

test('a Proxmox refusal is recorded as failed without leaking the error text', async () => {
  const { actions, fake } = await setup({ mode: 'execute' })
  fake.client.act = async () => { throw Error('proxmox-http-403') }
  const planId = (await actions.preview({ actionId: 'development', operation: 'reboot', requestedBy: 'owner@example.com' })).body.preview.planId
  const result = await actions.run({ planId, confirm: 'development', requestedBy: 'owner@example.com' })
  assert.equal(result.status, 502)
  assert.equal(result.body.run.state, 'failed')
  assert.equal(result.body.execution.reason, 'proxmox-http-403')
  assert.equal((await actions.list()).recent[0].detail, 'proxmox-http-403')
})

test('a gate closed while the pending record is written stops the run', async () => {
  let checks = 0
  const dir = await mkdtemp(join(tmpdir(), 'friday-homelab-'))
  const fake = fakeClient()
  const actions = await createHomelabActions({ enabled: true, mode: 'execute', catalog: parseHomelabCatalog(catalogFile()), client: fake.client,
    path: join(dir, 'runs.json'), automationGate: { isAllowed: () => ++checks === 1 } })
  const planId = (await actions.preview({ actionId: 'development', operation: 'reboot', requestedBy: 'owner@example.com' })).body.preview.planId
  const result = await actions.run({ planId, confirm: 'development', requestedBy: 'owner@example.com' })
  assert.equal(result.status, 423)
  assert.equal(fake.calls.some(([kind]) => kind === 'act'), false)
  const stored = JSON.parse(await readFile(join(dir, 'runs.json'), 'utf8'))
  assert.deepEqual([stored.runs[0].state, stored.runs[0].detail], ['failed', 'automation-gate-closed'])
})

const dockerEntry = { kind: 'docker', id: 'plex', name: 'plex', host: 'VM 100', container: 'plex', operations: ['restart', 'stop', 'start'] }

test('docker entries allow only start, stop and restart of a named container', () => {
  const parsed = parseHomelabCatalog({ schemaVersion: 1, actions: [dockerEntry] })
  assert.deepEqual(parsed[0].operations, ['start', 'stop', 'restart'])
  assert.equal(parsed[0].kind, 'docker')
  const bad = (change) => assert.throws(() => parseHomelabCatalog({ schemaVersion: 1, actions: [{ ...dockerEntry, ...change }] }), /invalid-homelab-catalog/)
  bad({ operations: ['reboot'] })
  bad({ operations: ['kill'] })
  bad({ container: '../plex' })
  bad({ container: 'plex;rm' })
  bad({ vmid: 100 })
  bad({ kind: 'k8s' })
  assert.throws(() => parseHomelabCatalog({ schemaVersion: 1, actions: [dockerEntry, { ...dockerEntry, id: 'plex-2' }] }), /invalid-homelab-catalog/)
})

test('the executor client sends the bearer token, maps Docker states, and refuses other operations', async () => {
  const calls = []
  const replies = { GET: { ok: true, state: 'exited' }, POST: { ok: true } }
  const fetchImpl = async (url, options) => { calls.push([options.method, url, options.headers.authorization, options.redirect]); return new Response(JSON.stringify(replies[options.method])) }
  const client = createDockerExecutorClient({ url: 'http://10.1.10.10:3198/', token: 't'.repeat(40), fetchImpl })
  assert.equal(client.ready, true)
  assert.deepEqual(await client.status(dockerEntry), { status: 'stopped' })
  await client.act(dockerEntry, 'restart')
  await assert.rejects(client.act(dockerEntry, 'kill'), /operation-not-allowed/)
  assert.deepEqual(calls, [
    ['GET', 'http://10.1.10.10:3198/v1/containers/plex', `Bearer ${'t'.repeat(40)}`, 'error'],
    ['POST', 'http://10.1.10.10:3198/v1/containers/plex/restart', `Bearer ${'t'.repeat(40)}`, 'error']])
  replies.GET = { ok: true, state: 'restarting' }
  assert.deepEqual(await client.status(dockerEntry), { status: 'unknown' })
  replies.POST = { ok: false, error: 'not-allowlisted' }
  await assert.rejects(client.act(dockerEntry, 'stop'), /executor-refused/)
  assert.equal(createDockerExecutorClient({ url: 'http://10.1.10.10:3198', token: 'short', fetchImpl }).ready, false)
  assert.equal(createDockerExecutorClient({ url: 'ftp://10.1.10.10', token: 't'.repeat(40), fetchImpl }).ready, false)
  assert.equal(createDockerExecutorClient({ url: 'http://user:pw@10.1.10.10', token: 't'.repeat(40), fetchImpl }).ready, false)
})

test('a catalog with containers needs the executor client; each entry uses its own client', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-homelab-'))
  const catalog = parseHomelabCatalog({ schemaVersion: 1, actions: [...catalogFile().actions, dockerEntry] })
  const proxmox = fakeClient()
  assert.equal((await createHomelabActions({ enabled: true, catalog, client: proxmox.client, path: join(dir, 'r.json') })).enabled, false)
  const dockerCalls = []
  const dockerClient = { ready: true, status: async () => ({ status: 'running' }), act: async (entry, op) => { dockerCalls.push([entry.container, op]); return { upid: null } } }
  const actions = await createHomelabActions({ enabled: true, mode: 'execute', catalog, client: proxmox.client, dockerClient,
    path: join(dir, 'r.json'), automationGate: { isAllowed: () => true } })
  assert.equal(actions.enabled, true)
  const preview = (await actions.preview({ actionId: 'plex', operation: 'restart', requestedBy: 'owner@example.com' })).body.preview
  assert.match(preview.summary, /Container plex on VM 100 is running/)
  const result = await actions.run({ planId: preview.planId, confirm: 'plex', requestedBy: 'owner@example.com' })
  assert.equal(result.body.run.state, 'submitted')
  assert.deepEqual(dockerCalls, [['plex', 'restart']])
  assert.equal(proxmox.calls.some(([kind]) => kind === 'act'), false)
  // A Docker-only catalog works without Proxmox.
  assert.equal((await createHomelabActions({ enabled: true, catalog: parseHomelabCatalog({ schemaVersion: 1, actions: [dockerEntry] }), dockerClient, path: join(dir, 'd.json') })).enabled, true)
})
