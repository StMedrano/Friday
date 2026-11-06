import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApprovalQueue, pendingProposals } from './queue.mjs'

const NOW = Date.parse('2026-11-05T19:00:00.000Z')
const incident = (id, extra = {}) => ({
  id, status: 'open', type: 'service-offline', title: 'Service offline', detail: `${id} is offline on vm102`,
  severity: 'high', serviceName: id, host: 'vm102', openedAt: '2026-11-05T18:00:00.000Z',
  recommendedAction: 'Inspect service status; any restart must go through approval.', ...extra,
})

async function tempPath() {
  return join(await mkdtemp(join(tmpdir(), 'friday-approvals-')), 'approvals.json')
}

test('open incidents with a recommended action become pending proposals, oldest first', () => {
  const pending = pendingProposals([
    incident('late', { openedAt: '2026-11-05T18:30:00.000Z' }),
    incident('early', { openedAt: '2026-11-05T17:00:00.000Z' }),
    incident('resolved', { status: 'resolved' }),
    incident('no-action', { recommendedAction: '' }),
  ], [])
  assert.deepEqual(pending.map((item) => item.id), ['early', 'late'])
  assert.deepEqual(pending[0], {
    id: 'early', incidentId: 'early', state: 'pending', openedAt: '2026-11-05T17:00:00.000Z',
    title: 'Service offline', detail: 'early is offline on vm102', serviceName: 'early', host: 'vm102',
    recommendedAction: 'Inspect service status; any restart must go through approval.', severity: 'high',
  })
})

test('approving records the decision once, never executes, and persists with 0600', async () => {
  const path = await tempPath()
  const queue = await createApprovalQueue({ path, now: () => NOW })
  const incidents = [incident('plex'), incident('nas')]
  const result = await queue.decide({ incidents, incidentId: 'plex', decision: 'approved', decidedBy: 'owner@example.com' })
  assert.equal(result.status, 200)
  assert.equal(result.body.execution.performed, false)
  assert.equal(result.body.approval.state, 'approved')
  assert.equal(result.body.approval.decidedBy, 'owner@example.com')
  assert.equal(result.body.approval.decidedAt, new Date(NOW).toISOString())
  assert.equal(result.body.approval.incidentStatus, 'open')

  const listed = queue.list(incidents)
  assert.deepEqual(listed.pending.map((item) => item.id), ['nas'])
  assert.deepEqual(listed.recent.map((item) => [item.incidentId, item.state]), [['plex', 'approved']])
  assert.equal(listed.execution.performed, false)

  assert.deepEqual((await queue.decide({ incidents, incidentId: 'plex', decision: 'denied' })).body, { error: 'approval-already-decided' })
  assert.equal((await stat(path)).mode & 0o777, 0o600)

  const reloaded = await createApprovalQueue({ path })
  assert.deepEqual(reloaded.list([]).recent.map((item) => [item.incidentId, item.state, item.incidentStatus, item.title]), [['plex', 'approved', 'resolved', 'Service offline']])
})

test('concurrent decisions on one proposal are serialized so only one wins', async () => {
  const queue = await createApprovalQueue({ path: await tempPath(), now: () => NOW })
  const incidents = [incident('plex')]
  const results = await Promise.all([
    queue.decide({ incidents, incidentId: 'plex', decision: 'approved' }),
    queue.decide({ incidents, incidentId: 'plex', decision: 'denied' }),
  ])
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
  assert.equal(queue.list(incidents).recent.length, 1)
})

test('rejects unknown proposals, resolved incidents and invalid decisions', async () => {
  const queue = await createApprovalQueue({ path: await tempPath() })
  const incidents = [incident('plex'), incident('done', { status: 'resolved' })]
  assert.equal((await queue.decide({ incidents, incidentId: 'missing', decision: 'approved' })).status, 404)
  assert.equal((await queue.decide({ incidents, incidentId: 'done', decision: 'approved' })).status, 404)
  assert.equal((await queue.decide({ incidents, incidentId: 'plex', decision: 'execute' })).status, 400)
  assert.equal(queue.list(incidents).recent.length, 0)
})

test('a failed write reports unavailable and keeps the proposal pending', async () => {
  const parentFile = join(await mkdtemp(join(tmpdir(), 'friday-approvals-')), 'not-a-dir')
  await writeFile(parentFile, 'x')
  const queue = await createApprovalQueue({ path: join(parentFile, 'approvals.json') })
  const incidents = [incident('plex')]
  assert.deepEqual((await queue.decide({ incidents, incidentId: 'plex', decision: 'approved' })).body, { error: 'approvals-unavailable' })
  assert.deepEqual(queue.list(incidents).pending.map((item) => item.id), ['plex'])
})

test('malformed stored decisions are dropped and the history is bounded', async () => {
  const path = await tempPath()
  await writeFile(path, JSON.stringify({ decisions: [
    { id: 'a', incidentId: 'x', decision: 'approved', decidedAt: '2026-11-05T00:00:00.000Z', proposal: { title: 'T' } },
    { id: 'b', incidentId: 'y', decision: 'run-it', decidedAt: '2026-11-05T00:00:00.000Z' },
    { id: 'c', incidentId: 'z', decision: 'denied', decidedAt: 'not-a-date' },
    'junk',
  ] }))
  const queue = await createApprovalQueue({ path, limit: 1, now: () => NOW })
  assert.deepEqual(queue.list([]).recent.map((item) => item.id), ['a'])
  // Incident x is resolved (absent), so its decision is the one pruned.
  await queue.decide({ incidents: [incident('plex')], incidentId: 'plex', decision: 'denied' })
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(stored.decisions.map((item) => item.incidentId), ['plex'])
})

test('pruning past the limit never reopens a decided proposal whose incident is still open', async () => {
  const queue = await createApprovalQueue({ path: await tempPath(), limit: 2, now: () => NOW })
  const incidents = ['a', 'b', 'c'].map((id) => incident(id))
  for (const id of ['a', 'b', 'c']) assert.equal((await queue.decide({ incidents, incidentId: id, decision: 'denied' })).status, 200)
  assert.deepEqual(queue.list(incidents).pending, [])
  assert.equal((await queue.decide({ incidents, incidentId: 'a', decision: 'approved' })).status, 409)

  // Once incident a resolves, its decision is the first to be pruned.
  const later = [incident('b'), incident('c'), incident('d')]
  await queue.decide({ incidents: later, incidentId: 'd', decision: 'approved' })
  assert.deepEqual(queue.list(later).recent.map((item) => item.incidentId).sort(), ['b', 'c', 'd'])
})
