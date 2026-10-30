import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { getConfig } from '../config.mjs'
import { createFridayServer } from '../http.mjs'
import { workSubjectHash } from './file-subject-grants.mjs'

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

const subject = 'c0ffee00-1111-2222-3333-444455556666'
const human = async () => ({ status: 200, identity: { subject, email: 'owner@example.test' } })
const service = async () => ({ status: 200, identity: { subject: 'svc-token', kind: 'service' } })

test('a signed-in person can read their own work identity hash and nothing else', async () => {
  await withServer({ config: getConfig({ FRIDAY_MODE: 'live' }), accessGateImpl: human }, async (base) => {
    const response = await fetch(base + '/api/settings/work-identity')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(Object.keys(body).sort(), ['granted', 'subjectHash'])
    assert.equal(body.subjectHash, workSubjectHash(subject))
    assert.equal(body.granted, false)
    // The raw subject and email must never be echoed back.
    assert.doesNotMatch(JSON.stringify(body), new RegExp(subject))
    assert.doesNotMatch(JSON.stringify(body), /owner@example\.test/)
  })
})

test('a service token has no work identity', async () => {
  await withServer({ config: getConfig({ FRIDAY_MODE: 'live' }), accessGateImpl: service }, async (base) => {
    const response = await fetch(base + '/api/settings/work-identity')
    assert.equal(response.status, 403)
    assert.equal((await response.json()).subjectHash, undefined)
  })
})

test('the identity route is read-only', async () => {
  await withServer({ config: getConfig({ FRIDAY_MODE: 'live' }), accessGateImpl: human }, async (base) => {
    const response = await fetch(base + '/api/settings/work-identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 404)
  })
})

test('it reports whether this person currently has a work grant', async () => {
  const bridge = { enabled: true, async listTasks() { return [] } }
  await withServer({ config: getConfig({ FRIDAY_MODE: 'live' }), accessGateImpl: human, workReadBridge: bridge }, async (base) => {
    assert.equal((await (await fetch(base + '/api/settings/work-identity')).json()).granted, true)
  })
  const denying = { enabled: true, async listTasks() { throw new Error('work-read-denied') } }
  await withServer({ config: getConfig({ FRIDAY_MODE: 'live' }), accessGateImpl: human, workReadBridge: denying }, async (base) => {
    assert.equal((await (await fetch(base + '/api/settings/work-identity')).json()).granted, false)
  })
})
