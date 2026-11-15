import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from '../config.mjs'
import {createFridayServer} from '../http.mjs'
import {createActionAudit} from '../audit/action-audit.mjs'
import {createHomelabActions, parseHomelabCatalog} from './actions.mjs'

const json = {'content-type': 'application/json'}
const operatorGate = async () => ({status: 200, identity: {subject: 'op-sub', email: 'op@example.com'}})
const viewerGate = async (_request, operatorOnly) => operatorOnly ? {status: 403} : {status: 200, identity: {subject: 'viewer'}}
const catalog = parseHomelabCatalog({schemaVersion: 1, actions: [
  {id: 'development', name: 'development', node: 'home', guestType: 'qemu', vmid: 140, operations: ['shutdown', 'reboot']},
]})

async function withServer(t, {gate = operatorGate, enabled = true, mode = 'dry-run', audit = true} = {}, fn) {
  const root = await mkdtemp(join(tmpdir(), 'friday-homelab-http-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const actionAudit = audit ? await createActionAudit({directory: join(root, 'audit')}) : null
  const acts = []
  const client = {ready: true, status: async () => ({status: 'running'}), act: async (guest, operation) => { acts.push([guest.vmid, operation]); return {upid: null} }}
  const homelabActions = enabled ? await createHomelabActions({enabled: true, mode, catalog, client, path: join(root, 'runs.json'),
    automationGate: {isAllowed: () => true}}) : null
  const server = createFridayServer({config: getConfig({FRIDAY_MODE: 'live'}), actionAudit, homelabActions, accessGateImpl: gate})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port, {actionAudit, acts}) }
  finally { server.close(); await once(server, 'close') }
}
const post = (base, path, body, headers = json) => fetch(base + path, {method: 'POST', headers, body: JSON.stringify(body)})
const preview = (base, body = {actionId: 'development', operation: 'reboot'}, headers) => post(base, '/api/homelab/actions/preview', body, headers)
const run = (base, body, headers) => post(base, '/api/homelab/actions/run', body, headers)

test('off by default: the list is 503 and the write routes are 404', async t => {
  await withServer(t, {enabled: false}, async base => {
    assert.deepEqual(await (await fetch(base + '/api/homelab/actions')).json(), {error: 'homelab-actions-disabled'})
    assert.equal((await preview(base)).status, 404)
    assert.equal((await run(base, {planId: 'x', confirm: 'development'})).status, 404)
  })
})

test('list, preview and a dry-run approval, each audited, with nothing changed', async t => {
  await withServer(t, {}, async (base, {actionAudit, acts}) => {
    const listed = await (await fetch(base + '/api/homelab/actions')).json()
    assert.equal(listed.mode, 'dry-run')
    assert.equal(listed.actions[0].status, 'running')
    assert.equal(listed.execution.performed, false)
    assert.equal((await post(base, '/api/homelab/actions', {})).status, 405)

    assert.equal((await preview(base, {actionId: 'development'})).status, 400)
    assert.equal((await preview(base, {actionId: 'development', operation: 'reboot', extra: 1})).status, 400)
    assert.equal((await preview(base, undefined, {'content-type': 'text/plain'})).status, 415)
    assert.equal((await preview(base, undefined, {...json, 'sec-fetch-site': 'cross-site'})).status, 403)
    assert.equal((await preview(base, {actionId: 'development', operation: 'start'})).status, 403)

    const planned = await (await preview(base)).json()
    assert.equal(planned.preview.allowed, true)
    assert.equal(planned.execution.performed, false)
    assert.equal((await run(base, {planId: planned.preview.planId, confirm: 'nope'})).status, 400)
    const ran = await run(base, {planId: planned.preview.planId, confirm: 'development'})
    assert.equal(ran.status, 200)
    const body = await ran.json()
    assert.equal(body.run.state, 'dry-run')
    assert.equal(body.execution.performed, false)
    assert.deepEqual(acts, [])
    assert.equal((await (await fetch(base + '/api/homelab/actions')).json()).recent[0].requestedBy, 'op@example.com')

    const previews = (await actionAudit.list({action: 'homelab.actions.preview'})).events
    assert.ok(previews.some(event => event.phase === 'succeeded' && event.target === 'development:reboot'))
    const runs = (await actionAudit.list({action: 'homelab.actions.run'})).events
    assert.ok(runs.some(event => event.phase === 'succeeded'))
    assert.ok(runs.some(event => event.phase === 'failed'), 'the mismatched confirmation is audited too')
  })
})

test('viewers cannot preview or run', async t => {
  await withServer(t, {gate: viewerGate}, async base => {
    assert.equal((await (await fetch(base + '/api/homelab/actions')).json()).actions.length, 1)
    assert.equal((await preview(base)).status, 403)
    assert.equal((await run(base, {planId: 'x', confirm: 'development'})).status, 403)
  })
})

test('execute mode needs a signed-in human operator and the durable audit, then acts once', async t => {
  const serviceGate = async () => ({status: 200, identity: {kind: 'service', subject: 'svc'}})
  await withServer(t, {gate: serviceGate, mode: 'execute'}, async base => {
    assert.equal((await preview(base)).status, 403)
  })
  await withServer(t, {mode: 'execute', audit: false}, async base => {
    assert.deepEqual(await (await preview(base)).json(), {error: 'audit-unavailable'})
  })
  await withServer(t, {mode: 'execute'}, async (base, {acts}) => {
    const planned = await (await preview(base)).json()
    const ran = await run(base, {planId: planned.preview.planId, confirm: 'development'})
    assert.equal(ran.status, 200)
    assert.equal((await ran.json()).execution.performed, true)
    assert.deepEqual(acts, [[140, 'reboot']])
    assert.equal((await run(base, {planId: planned.preview.planId, confirm: 'development'})).status, 409)
    assert.equal(acts.length, 1)
  })
})
