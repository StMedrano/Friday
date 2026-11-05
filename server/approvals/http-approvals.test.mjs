import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from '../config.mjs'
import {createFridayServer} from '../http.mjs'
import {createActionAudit} from '../audit/action-audit.mjs'
import {createApprovalQueue} from './queue.mjs'

const json = {'content-type': 'application/json'}
const operatorGate = async () => ({status: 200, identity: {subject: 'op-sub', email: 'op@example.com'}})
const viewerGate = async (_request, operatorOnly) => operatorOnly ? {status: 403} : {status: 200, identity: {subject: 'viewer'}}
const incidents = [
  {id: 'svc-offline-1', status: 'open', title: 'Service offline', detail: 'plex is offline on vm102', severity: 'high', serviceName: 'plex', host: 'vm102',
    openedAt: '2026-11-05T18:00:00.000Z', recommendedAction: 'Inspect service status; any restart must go through approval.'},
]
const monitoringRuntime = {getIncidents: () => ({summary: {}, incidents})}

async function withServer(t, options, fn) {
  const root = await mkdtemp(join(tmpdir(), 'friday-approvals-http-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const approvalQueue = options.approvals === false ? null : await createApprovalQueue({path: join(root, 'approvals.json')})
  const actionAudit = await createActionAudit({directory: join(root, 'audit')})
  const server = createFridayServer({config: getConfig({FRIDAY_MODE: 'live', FRIDAY_MONITORING_ENABLED: 'true'}), monitoringRuntime, approvalQueue, actionAudit, ...options})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port, actionAudit) }
  finally { server.close(); await once(server, 'close') }
}

const decide = (base, id, body, headers = json) => fetch(`${base}/api/approvals/${id}/decision`, {method: 'POST', headers, body: JSON.stringify(body)})

test('approvals are off unless the queue is configured', async t => {
  await withServer(t, {accessGateImpl: operatorGate, approvals: false}, async base => {
    const listed = await fetch(base + '/api/approvals')
    assert.equal(listed.status, 503)
    assert.deepEqual(await listed.json(), {error: 'approvals-disabled'})
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'approve'})).status, 503)
  })
})

test('lists pending proposals and records an operator decision in the audit without executing', async t => {
  await withServer(t, {accessGateImpl: operatorGate}, async (base, audit) => {
    const listed = await (await fetch(base + '/api/approvals')).json()
    assert.deepEqual(listed.pending.map(item => item.id), ['svc-offline-1'])
    assert.equal(listed.execution.performed, false)

    assert.equal((await decide(base, 'svc-offline-1', {decision: 'approve'}, {'content-type': 'text/plain'})).status, 415)
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'approve'}, {...json, 'sec-fetch-site': 'cross-site'})).status, 403)
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'run'})).status, 400)
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'approve', extra: 1})).status, 400)
    assert.equal((await decide(base, 'bad%20id', {decision: 'approve'})).status, 400)
    assert.equal((await decide(base, 'missing', {decision: 'approve'})).status, 404)

    const approved = await decide(base, 'svc-offline-1', {decision: 'approve'})
    assert.equal(approved.status, 200)
    const body = await approved.json()
    assert.equal(body.approval.state, 'approved')
    assert.equal(body.approval.decidedBy, 'op@example.com')
    assert.equal(body.execution.performed, false)
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'deny'})).status, 409)

    const after = await (await fetch(base + '/api/approvals')).json()
    assert.deepEqual(after.pending, [])
    assert.deepEqual(after.recent.map(item => [item.incidentId, item.state]), [['svc-offline-1', 'approved']])

    const events = (await audit.list({action: 'approvals.decide'})).events
    assert.ok(events.some(event => event.phase === 'succeeded' && event.target === 'svc-offline-1'))
    assert.equal((await fetch(base + '/api/approvals', {method: 'POST', headers: json, body: '{}'})).status, 405)
    assert.equal((await fetch(base + '/api/approvals?x=1')).status, 400)
  })
})

test('viewers can read the queue but cannot decide', async t => {
  await withServer(t, {accessGateImpl: viewerGate}, async base => {
    assert.equal((await fetch(base + '/api/approvals')).status, 200)
    assert.equal((await decide(base, 'svc-offline-1', {decision: 'approve'})).status, 403)
  })
})
