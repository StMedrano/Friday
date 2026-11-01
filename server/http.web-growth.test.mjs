import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'

const snapshot = { schemaVersion: '1', projectId: 'techtactics-web-growth', generatedAt: '2026-10-14T12:00:00Z', sourceRevision: 'abcdef0', sourceChecksum: 'a'.repeat(64), leads: [] }
const reader = { subject: 'reader-sub', email: 'reader@example.test' }
const gateFor = (identity) => async () => ({ status: 200, identity })
const liveConfig = (webGrowth = {}) => ({ ...getConfig({ FRIDAY_MODE: 'live' }), webGrowth: { enabled: true, baseUrl: 'https://reader.example', token: 'x'.repeat(32), readerEmails: ['reader@example.test'], ...webGrowth } })

async function withServer(options, fn) {
  let calls = 0
  const server = createFridayServer({
    config: liveConfig(), accessGateImpl: gateFor(reader),
    readWebGrowthImpl: async () => { calls += 1; return snapshot },
    ...options,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port, () => calls) }
  finally { server.close(); await once(server, 'close') }
}

test('Web Growth is disabled with no readers by default', () => {
  assert.deepEqual(getConfig({}).webGrowth, { enabled: false, baseUrl: '', token: '', readerEmails: [] })
  assert.deepEqual(getConfig({ FRIDAY_WEB_GROWTH_READER_EMAILS: ' Reader@Example.test, ,reader@example.test' }).webGrowth.readerEmails, ['reader@example.test'])
})

test('a named reader receives the validated snapshot with no-store', async () => {
  await withServer({}, async (base, calls) => {
    const response = await fetch(base + '/api/web-growth')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), snapshot)
    assert.equal(calls(), 1)
  })
})

test('people without the project reader grant, service tokens and unsigned requests never reach the reader', async () => {
  for (const options of [
    { accessGateImpl: gateFor({ subject: 'other', email: 'other@example.test' }) },
    { accessGateImpl: gateFor({ subject: 'svc', kind: 'service' }) },
    { accessGateImpl: async () => ({ status: 403 }) },
    { config: { ...liveConfig(), access: { ...liveConfig().access, enabled: false } }, accessGateImpl: null },
    { config: liveConfig({ readerEmails: [] }) },
  ]) {
    await withServer(options, async (base, calls) => {
      const response = await fetch(base + '/api/web-growth')
      assert.ok([403, 503].includes(response.status), String(response.status))
      assert.equal(calls(), 0)
    })
  }
})

test('queries and writes are refused before the reader is contacted', async () => {
  await withServer({}, async (base, calls) => {
    assert.equal((await fetch(base + '/api/web-growth?actor=admin')).status, 400)
    assert.equal((await fetch(base + '/api/web-growth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405)
    assert.equal(calls(), 0)
  })
})

test('a disabled connection or bad reader data returns a sanitized 503, never empty data', async () => {
  for (const options of [
    { config: liveConfig({ enabled: false }) },
    { readWebGrowthImpl: async () => { throw new Error('secret detail') } },
    { readWebGrowthImpl: async () => ({ ...snapshot, private: 'secret detail' }) },
  ]) {
    await withServer(options, async (base) => {
      const response = await fetch(base + '/api/web-growth')
      assert.equal(response.status, 503)
      assert.doesNotMatch(await response.text(), /secret|leads/)
    })
  }
})
