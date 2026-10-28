import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFridayServer} from './http.mjs'
import {getConfig} from './config.mjs'
import {createActionAudit} from './audit/action-audit.mjs'

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

async function audit(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-http-audit-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  return createActionAudit({directory: join(root, 'audit')})
}

const json = {'content-type': 'application/json'}
const registry = calls => ({sync: async () => { calls.push('sync'); return {status: 'ok'} }})
const monitoring = calls => ({
  rerunDiagnostic: async id => { calls.push(id); return id === 'i1' ? {statusCode: 200, body: {incidentId: 'i1'}} : {statusCode: 404, body: {error: 'incident-not-found'}} },
})
const operatorGate = async () => ({status: 200, identity: {subject: 'op-sub', email: 'op@example.com'}})

test('audited actions record requested and outcome events with the verified actor', async t => {
  const actionAudit = await audit(t)
  const calls = []
  const config = getConfig({FRIDAY_MODE: 'live'})
  await withServer({config, accessGateImpl: operatorGate, actionAudit, agentRegistryService: registry(calls), monitoringRuntime: monitoring(calls)}, async base => {
    assert.equal((await fetch(base + '/api/agents/registry/sync', {method: 'POST', headers: json, body: '{}'})).status, 200)
    assert.equal((await fetch(base + '/api/incidents/i1/diagnostics/rerun', {method: 'POST'})).status, 200)
    assert.equal((await fetch(base + '/api/incidents/gone/diagnostics/rerun', {method: 'POST'})).status, 404)
    const response = await fetch(base + '/api/audit/events?limit=10')
    assert.equal(response.status, 200)
    const page = await response.json()
    assert.equal(page.integrity, 'verified')
    const rows = page.events.map(e => [e.action, e.phase, e.target, e.detail]).reverse()
    assert.deepEqual(rows, [
      ['agents.registry.sync', 'requested', null, null],
      ['agents.registry.sync', 'succeeded', null, null],
      ['incidents.diagnostics.rerun', 'requested', 'i1', null],
      ['incidents.diagnostics.rerun', 'succeeded', 'i1', null],
      ['incidents.diagnostics.rerun', 'requested', 'gone', null],
      ['incidents.diagnostics.rerun', 'failed', 'gone', 'incident-not-found'],
    ])
    assert.equal(page.events[0].requestId, page.events[1].requestId)
    assert.equal(page.events[0].actor.label, 'op@example.com')
    assert.ok(!JSON.stringify(page).includes('op-sub'))
  })
  assert.deepEqual(calls, ['sync', 'i1', 'gone'])
})

test('an unavailable audit refuses audited actions before they run', async () => {
  const calls = []
  const broken = Object.freeze({record: async () => { throw Error('audit-unavailable') }, list: async () => { throw Error('audit-unavailable') }, status: () => ({integrity: 'broken'})})
  const config = getConfig({})
  await withServer({config, actionAudit: broken, agentRegistryService: registry(calls), monitoringRuntime: monitoring(calls)}, async base => {
    const sync = await fetch(base + '/api/agents/registry/sync', {method: 'POST', headers: json, body: '{}'})
    assert.equal(sync.status, 503)
    assert.deepEqual(await sync.json(), {error: 'audit-unavailable'})
    assert.equal((await fetch(base + '/api/incidents/i1/diagnostics/rerun', {method: 'POST'})).status, 503)
    assert.equal((await fetch(base + '/api/audit/events')).status, 503)
  })
  assert.deepEqual(calls, [])
})

test('invalid requests are rejected before any audit record is written', async t => {
  const actionAudit = await audit(t)
  await withServer({config: getConfig({}), actionAudit, agentRegistryService: registry([])}, async base => {
    assert.equal((await fetch(base + '/api/agents/registry/sync', {method: 'POST', headers: json, body: '{"force":true}'})).status, 400)
  })
  assert.equal((await actionAudit.list()).events.length, 0)
})

test('audit reads require an operator identity and validate the query', async t => {
  const actionAudit = await audit(t)
  const config = getConfig({FRIDAY_MODE: 'live'})
  const seen = []
  const gate = async (_request, operatorOnly) => { seen.push(operatorOnly); return operatorOnly ? {status: 403, error: 'access-denied'} : {status: 200, identity: {subject: 'viewer'}} }
  await withServer({config, accessGateImpl: gate, actionAudit}, async base => {
    assert.equal((await fetch(base + '/api/audit/events')).status, 403)
  })
  assert.deepEqual(seen, [true])
  await withServer({config, accessGateImpl: operatorGate, actionAudit}, async base => {
    for (const query of ['limit=0', 'limit=abc', 'limit=500', 'before=-1', 'before=1.5', 'action=proxmox.delete'])
      assert.equal((await fetch(base + '/api/audit/events?' + query)).status, 400, query)
    for (const method of ['POST', 'PUT', 'DELETE'])
      assert.equal((await fetch(base + '/api/audit/events', {method})).status, 404, method)
  })
})

test('audit endpoint reports not-enabled without a store, and actions run unaudited as before', async () => {
  const calls = []
  await withServer({config: getConfig({}), agentRegistryService: registry(calls)}, async base => {
    const response = await fetch(base + '/api/audit/events')
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {error: 'audit-not-enabled'})
    assert.equal((await fetch(base + '/api/agents/registry/sync', {method: 'POST', headers: json, body: '{}'})).status, 200)
  })
  assert.deepEqual(calls, ['sync'])
})

test('audit configuration is opt-in with a private data default', () => {
  assert.deepEqual(getConfig({}).audit, {enabled: false, directory: '/data/audit', maxBytes: 16 * 1024 * 1024})
  assert.deepEqual(getConfig({FRIDAY_AUDIT_ENABLED: 'true', FRIDAY_AUDIT_DIR: '/var/lib/friday/audit', FRIDAY_AUDIT_MAX_BYTES: '1048576'}).audit,
    {enabled: true, directory: '/var/lib/friday/audit', maxBytes: 1048576})
})
