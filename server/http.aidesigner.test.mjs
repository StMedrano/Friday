import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'
import { AiDesignerError } from './adapters/aidesigner.mjs'

const SESSION = '1b8f3c2a-3d4e-4f5a-9b1c-8e7d6f5a4b3c'
const operator = { subject: 'operator-sub', email: 'operator@example.test' }
const liveConfig = (aidesigner = {}) => ({
  ...getConfig({ FRIDAY_MODE: 'live' }),
  aidesigner: { enabled: true, apiKey: 'gp_' + 'k'.repeat(40), baseUrl: 'https://api.aidesigner.ai', timeoutMs: 1000, ...aidesigner },
})
const generated = { sessionId: SESSION, canvasId: null, runId: null, editorUrl: 'https://app.aidesigner.ai/editor/' + SESSION, canvasDelivery: 'appended', replay: false, htmlBytes: 10 }

async function withServer(options, fn) {
  const calls = { list: 0, generate: [], gate: [] }
  const client = {
    listSessions: async () => { calls.list += 1; return [{ sessionId: SESSION, title: 'Landing', editorUrl: null, canvasCount: 1, publishedUrl: null, updatedAt: null }] },
    generateDesign: async (input) => { calls.generate.push(input); return generated },
  }
  const server = createFridayServer({
    config: liveConfig(),
    accessGateImpl: async (request, operatorOnly) => { calls.gate.push(operatorOnly); return { status: 200, identity: operator } },
    aiDesignerImpl: () => client,
    ...options,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port, calls) }
  finally { server.close(); await once(server, 'close') }
}

const post = (base, body, headers = {}) => fetch(base + '/api/aidesigner/designs', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
})

test('a signed-in person can list AIDesigner sessions', async () => {
  await withServer({}, async (base, calls) => {
    const response = await fetch(base + '/api/aidesigner/sessions')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { sessions: [{ sessionId: SESSION, title: 'Landing', editorUrl: null, canvasCount: 1, publishedUrl: null, updatedAt: null }] })
    assert.equal(calls.list, 1)
    assert.deepEqual(calls.gate, [false])
  })
})

test('generation is operator-only, needs JSON and returns references, not HTML', async () => {
  await withServer({}, async (base, calls) => {
    const response = await post(base, { prompt: '  A homelab status page  ', viewport: 'mobile' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), generated)
    assert.deepEqual(calls.gate, [true])
    assert.equal(calls.generate.length, 1)
    const input = calls.generate[0]
    assert.equal(input.prompt, 'A homelab status page')
    assert.equal(input.viewport, 'mobile')
    assert.equal(input.sessionId, null)
    assert.match(input.idempotencyKey, /^[A-Za-z0-9_-]{8,128}$/)

    assert.equal((await fetch(base + '/api/aidesigner/designs', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415)
    assert.equal((await post(base, { prompt: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal(calls.generate.length, 1)
  })
})

test('a caller key and existing session pass through', async () => {
  await withServer({}, async (base, calls) => {
    assert.equal((await post(base, { prompt: 'x', sessionId: SESSION, idempotencyKey: 'retry-key-0001' })).status, 200)
    assert.equal(calls.generate[0].sessionId, SESSION)
    assert.equal(calls.generate[0].idempotencyKey, 'retry-key-0001')
    assert.equal(calls.generate[0].viewport, 'desktop')
  })
})

test('bad generation input is refused before AIDesigner is contacted', async () => {
  await withServer({}, async (base, calls) => {
    for (const body of [
      {}, { prompt: '' }, { prompt: '   ' }, { prompt: 7 }, { prompt: 'x'.repeat(4001) },
      { prompt: 'x', viewport: 'tablet' }, { prompt: 'x', sessionId: 'nope' }, { prompt: 'x', idempotencyKey: 'short' },
      { prompt: 'x', design_mode: 'ultradesign' }, [],
    ]) {
      const response = await post(base, body)
      assert.equal(response.status, 400, JSON.stringify(body))
      assert.equal((await response.json()).error, 'invalid-design-request')
    }
    assert.equal(calls.generate.length, 0)
  })
})

test('service tokens, denied people and a disabled or unsigned setup never reach AIDesigner', async () => {
  for (const options of [
    { accessGateImpl: async () => ({ status: 200, identity: { subject: 'svc', kind: 'service' } }) },
    { accessGateImpl: async () => ({ status: 403 }) },
    { config: liveConfig({ enabled: false }) },
    { config: { ...liveConfig(), access: { ...liveConfig().access, enabled: false } }, accessGateImpl: null },
    { config: { ...liveConfig(), mode: 'mock' } },
  ]) {
    await withServer(options, async (base, calls) => {
      assert.ok([403, 503].includes((await fetch(base + '/api/aidesigner/sessions')).status))
      assert.ok([403, 503].includes((await post(base, { prompt: 'x' })).status))
      assert.equal(calls.list, 0)
      assert.equal(calls.generate.length, 0)
    })
  }
})

test('other methods and queries are refused', async () => {
  await withServer({}, async (base, calls) => {
    assert.equal((await fetch(base + '/api/aidesigner/sessions?limit=500')).status, 400)
    assert.equal((await fetch(base + '/api/aidesigner/sessions', { method: 'DELETE' })).status, 405)
    assert.equal((await fetch(base + '/api/aidesigner/designs')).status, 405)
    assert.equal(calls.list, 0)
  })
})

test('provider errors map to sanitized statuses', async () => {
  const cases = [
    ['aidesigner-auth-failed', 502], ['aidesigner-credits-exhausted', 402], ['aidesigner-rate-limited', 429],
    ['aidesigner-session-not-found', 404], ['aidesigner-canvas-busy', 409], ['aidesigner-request-rejected', 400], ['aidesigner-unavailable', 503],
  ]
  for (const [code, status] of cases) {
    const client = {
      listSessions: async () => { throw new AiDesignerError(code, 30) },
      generateDesign: async () => { throw new AiDesignerError(code, 30) },
    }
    await withServer({ aiDesignerImpl: () => client }, async (base) => {
      const response = await post(base, { prompt: 'x' })
      assert.equal(response.status, status, code)
      assert.deepEqual(await response.json(), { error: code })
      if (status === 429) assert.equal(response.headers.get('retry-after'), '30')
    })
  }
  const crash = { generateDesign: async () => { throw new Error('secret detail') }, listSessions: async () => { throw new Error('secret detail') } }
  await withServer({ aiDesignerImpl: () => crash }, async (base) => {
    const response = await fetch(base + '/api/aidesigner/sessions')
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /secret/)
  })
})

test('generation is audited when an audit store is configured', async () => {
  const events = []
  const actionAudit = { record: async (event) => { events.push(event); return { requestId: 'r1' } } }
  await withServer({ actionAudit }, async (base) => {
    assert.equal((await post(base, { prompt: 'x', sessionId: SESSION })).status, 200)
  })
  assert.deepEqual(events.map(event => [event.action, event.phase, event.target]), [
    ['aidesigner.design.generate', 'requested', SESSION], ['aidesigner.design.generate', 'succeeded', SESSION],
  ])
})
