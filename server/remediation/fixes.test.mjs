import test from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRemediationRunner, loadPlaybooks, parsePlaybooks, playbookFor} from './fixes.mjs'

const playbook = {id: 'restart-plex', serviceId: 'docker:plex', action: 'restart-container', target: 'plex', description: 'Restart the plex container'}
const incident = {id: 'inc-1', status: 'open', serviceId: 'docker:plex', type: 'service-offline'}
const approval = {id: 'appr-1', incidentId: 'inc-1', decision: 'approved'}

async function tempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-fixes-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  return root
}

test('playbooks are validated strictly and matched by service and optional type', () => {
  const playbooks = parsePlaybooks({schemaVersion: 1, playbooks: [playbook, {...playbook, id: 'typed', serviceId: 'docker:web', incidentTypes: ['service-degraded']}]})
  assert.equal(playbookFor(playbooks, incident).id, 'restart-plex')
  assert.equal(playbookFor(playbooks, {serviceId: 'docker:web', type: 'service-offline'}), null)
  assert.equal(playbookFor(playbooks, {serviceId: 'docker:web', type: 'service-degraded'}).id, 'typed')
  for (const bad of [
    {schemaVersion: 2, playbooks: []},
    {schemaVersion: 1, playbooks: [{...playbook, extra: 1}]},
    {schemaVersion: 1, playbooks: [{...playbook, action: 'rm -rf /'}]},
    {schemaVersion: 1, playbooks: [{...playbook, target: '../etc'}]},
    {schemaVersion: 1, playbooks: [playbook, playbook]},
  ]) assert.throws(() => parsePlaybooks(bad))
})

test('loadPlaybooks refuses group- or world-writable and invalid files', async t => {
  const root = await tempDir(t)
  const file = join(root, 'playbooks.json')
  await writeFile(file, JSON.stringify({schemaVersion: 1, playbooks: [playbook]}), {mode: 0o600})
  assert.equal((await loadPlaybooks(file)).length, 1)
  await chmod(file, 0o666)
  assert.equal(await loadPlaybooks(file), null)
  assert.equal(await loadPlaybooks(join(root, 'missing.json')), null)
})

test('dry-run records what would run, once per approval, and executes nothing', async t => {
  const root = await tempDir(t)
  let calls = 0
  const runner = await createRemediationRunner({enabled: true, playbooks: [playbook], path: join(root, 'runs.json'), fetchImpl: async () => { calls++ }})
  assert.equal(runner.mode, 'dry-run')
  const result = await runner.run({incidents: [incident], incidentId: 'inc-1', approval, requestedBy: 'op@example.com'})
  assert.equal(result.status, 200)
  assert.equal(result.body.execution.performed, false)
  assert.equal(result.body.fix.state, 'dry-run')
  assert.equal(calls, 0)
  assert.equal((await runner.run({incidents: [incident], incidentId: 'inc-1', approval})).body.error, 'fix-already-run')
  assert.equal(runner.describe(incident, 'appr-1').run.state, 'dry-run')
  const stored = JSON.parse(await readFile(join(root, 'runs.json'), 'utf8'))
  assert.equal(stored.runs.length, 1)
})

test('refuses without an approval, for a denied or closed incident, or without a playbook', async t => {
  const root = await tempDir(t)
  const runner = await createRemediationRunner({enabled: true, playbooks: [playbook], path: join(root, 'runs.json')})
  const run = (extra) => runner.run({incidents: [incident], incidentId: 'inc-1', approval, ...extra})
  assert.equal((await run({approval: null})).body.error, 'fix-not-approved')
  assert.equal((await run({approval: {...approval, decision: 'denied'}})).body.error, 'fix-not-approved')
  assert.equal((await run({approval: {...approval, incidentId: 'other'}})).body.error, 'fix-not-approved')
  assert.equal((await run({incidents: [{...incident, status: 'resolved'}]})).body.error, 'incident-not-open')
  assert.equal((await run({incidents: [{...incident, serviceId: 'docker:other'}]})).body.error, 'no-fix-for-service')
  const off = await createRemediationRunner({enabled: false, playbooks: [playbook], path: join(root, 'runs.json')})
  assert.equal(off.enabled, false)
  assert.equal((await off.run({incidents: [incident], incidentId: 'inc-1', approval})).status, 404)
})

test('execute mode needs an https executor, a token and the gate; a closed gate stops it before any call', async t => {
  const root = await tempDir(t)
  const base = {enabled: true, mode: 'execute', playbooks: [playbook], path: join(root, 'runs.json')}
  assert.equal((await createRemediationRunner({...base, executor: {url: 'http://executor', token: 't'}, automationGate: {isAllowed: () => true}})).enabled, false)
  assert.equal((await createRemediationRunner({...base, executor: {url: 'https://executor', token: ''}, automationGate: {isAllowed: () => true}})).enabled, false)
  assert.equal((await createRemediationRunner({...base, executor: {url: 'https://executor', token: 't'}})).enabled, false)
  let calls = 0
  const closed = await createRemediationRunner({...base, executor: {url: 'https://executor.test/fix', token: 't'},
    automationGate: {isAllowed: () => false}, fetchImpl: async () => { calls++ }})
  const result = await closed.run({incidents: [incident], incidentId: 'inc-1', approval})
  assert.equal(result.status, 423)
  assert.equal(calls, 0)
})

test('execute mode sends only the playbook action to the executor and records the outcome', async t => {
  const root = await tempDir(t)
  const sent = []
  const reply = {ok: true}
  const runner = await createRemediationRunner({enabled: true, mode: 'execute', playbooks: [playbook], path: join(root, 'runs.json'),
    executor: {url: 'https://executor.test/fix', token: 'exec-token'}, automationGate: {isAllowed: () => true},
    fetchImpl: async (url, options) => { sent.push({url, options}); return new Response(JSON.stringify(reply), {status: 200}) }})
  const failed = await (async () => { reply.ok = false; return runner.run({incidents: [incident], incidentId: 'inc-1', approval}) })()
  assert.equal(failed.status, 502)
  assert.equal(failed.body.execution.succeeded, false)
  // A failed run may be retried; a successful one may not.
  reply.ok = true
  const ok = await runner.run({incidents: [incident], incidentId: 'inc-1', approval})
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.execution, {performed: true, succeeded: true})
  assert.equal((await runner.run({incidents: [incident], incidentId: 'inc-1', approval})).body.error, 'fix-already-run')
  assert.equal(sent.length, 2)
  assert.equal(sent[0].url, 'https://executor.test/fix')
  assert.equal(sent[0].options.headers.authorization, 'Bearer exec-token')
  assert.equal(sent[0].options.redirect, 'error')
  const body = JSON.parse(sent[1].options.body)
  assert.deepEqual(Object.keys(body).sort(), ['action', 'incidentId', 'playbookId', 'requestId', 'target'])
  assert.equal(body.action, 'restart-container')
  assert.ok(!JSON.stringify(await readFile(join(root, 'runs.json'), 'utf8')).includes('exec-token'))
})
