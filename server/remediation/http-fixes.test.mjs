import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from '../config.mjs'
import {createFridayServer} from '../http.mjs'
import {createActionAudit} from '../audit/action-audit.mjs'
import {createApprovalQueue} from '../approvals/queue.mjs'
import {createRemediationRunner} from './fixes.mjs'

const json = {'content-type': 'application/json'}
const operatorGate = async () => ({status: 200, identity: {subject: 'op-sub', email: 'op@example.com'}})
const viewerGate = async (_request, operatorOnly) => operatorOnly ? {status: 403} : {status: 200, identity: {subject: 'viewer'}}
const incidents = [
  {id: 'svc-offline-1', status: 'open', title: 'Service offline', severity: 'high', serviceId: 'docker:plex', serviceName: 'plex',
    openedAt: '2026-11-05T18:00:00.000Z', recommendedAction: 'Restart after approval.'},
]
const monitoringRuntime = {getIncidents: () => ({summary: {}, incidents})}
const playbook = {id: 'restart-plex', serviceId: 'docker:plex', action: 'restart-container', target: 'plex', description: 'Restart the plex container'}

async function withServer(t, {gate = operatorGate, remediation = true} = {}, fn) {
  const root = await mkdtemp(join(tmpdir(), 'friday-fixes-http-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const approvalQueue = await createApprovalQueue({path: join(root, 'approvals.json')})
  const actionAudit = await createActionAudit({directory: join(root, 'audit')})
  const runner = remediation ? await createRemediationRunner({enabled: true, playbooks: [playbook], path: join(root, 'runs.json')}) : null
  const server = createFridayServer({config: getConfig({FRIDAY_MODE: 'live', FRIDAY_MONITORING_ENABLED: 'true'}),
    monitoringRuntime, approvalQueue, actionAudit, remediation: runner, accessGateImpl: gate})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port, actionAudit) }
  finally { server.close(); await once(server, 'close') }
}
const post = (base, path, body, headers = json) => fetch(base + path, {method: 'POST', headers, body: JSON.stringify(body)})
const fix = (base, body = {confirm: 'svc-offline-1'}, headers) => post(base, '/api/approvals/svc-offline-1/fix', body, headers)

test('the fix route is 404 when automated fixes are off, and the list is unchanged', async t => {
  await withServer(t, {remediation: false}, async base => {
    assert.equal((await fix(base)).status, 404)
    const listed = await (await fetch(base + '/api/approvals')).json()
    assert.equal(listed.fixes, undefined)
  })
})

test('a fix needs an approval first, then runs once in dry-run and is audited', async t => {
  await withServer(t, {}, async (base, audit) => {
    assert.deepEqual(await (await fix(base)).json(), {error: 'fix-not-approved'})
    assert.equal((await post(base, '/api/approvals/svc-offline-1/decision', {decision: 'approve'})).status, 200)

    const listed = await (await fetch(base + '/api/approvals')).json()
    assert.deepEqual(listed.fixes, {enabled: true, mode: 'dry-run'})
    assert.equal(listed.execution.performed, false)
    assert.deepEqual(listed.recent[0].fix, {playbookId: 'restart-plex', action: 'restart-container', target: 'plex',
      description: 'Restart the plex container', mode: 'dry-run'})

    assert.equal((await fix(base, {confirm: 'other'})).status, 400)
    assert.equal((await fix(base, {})).status, 400)
    assert.equal((await fix(base, {confirm: 'svc-offline-1'}, {'content-type': 'text/plain'})).status, 415)
    assert.equal((await fix(base, {confirm: 'svc-offline-1'}, {...json, 'sec-fetch-site': 'cross-site'})).status, 403)

    const ran = await fix(base)
    assert.equal(ran.status, 200)
    const body = await ran.json()
    assert.equal(body.fix.state, 'dry-run')
    assert.equal(body.execution.performed, false)
    assert.deepEqual(await (await fix(base)).json(), {error: 'fix-already-run'})
    const after = await (await fetch(base + '/api/approvals')).json()
    assert.equal(after.recent[0].fix.run.state, 'dry-run')
    const events = (await audit.list({action: 'approvals.fix'})).events
    assert.ok(events.some(event => event.phase === 'succeeded' && event.target === 'svc-offline-1'))
  })
})

test('viewers cannot run a fix', async t => {
  await withServer(t, {gate: viewerGate}, async base => {
    assert.equal((await fix(base)).status, 403)
  })
})
