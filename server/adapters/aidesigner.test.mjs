import test from 'node:test'
import assert from 'node:assert/strict'
import { createAiDesigner } from './aidesigner.mjs'
import { getConfig } from '../config.mjs'

const SESSION = '1b8f3c2a-3d4e-4f5a-9b1c-8e7d6f5a4b3c'
const CANVAS = '9e21d4f0-6c3b-4a2d-8f1e-0d9c8b7a6f5e'
const RUN = '4a7e9c10-2b1a-4c3d-8e7f-6a5b4c3d2e1f'
const KEY = 'gp_' + 'k'.repeat(40)
const config = (overrides = {}) => ({ enabled: true, apiKey: KEY, baseUrl: 'https://api.aidesigner.ai', timeoutMs: 1000, ...overrides })

function reply(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function recorder(response) {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return typeof response === 'function' ? response(url, init) : response }
  return { calls, fetchImpl }
}

test('AIDesigner is disabled with no key by default', () => {
  assert.deepEqual(getConfig({}).aidesigner, { enabled: false, apiKey: '', baseUrl: 'https://api.aidesigner.ai', timeoutMs: 180000 })
  assert.equal(getConfig({ FRIDAY_AIDESIGNER_ENABLED: 'true', AIDESIGNER_API_KEY: KEY }).aidesigner.enabled, true)
  assert.equal(getConfig({ FRIDAY_AIDESIGNER_TIMEOUT_MS: '30000' }).aidesigner.timeoutMs, 30000)
})

test('an unusable configuration never contacts AIDesigner', async () => {
  for (const bad of [
    config({ enabled: false }),
    config({ apiKey: '' }),
    config({ apiKey: 'has space ' + KEY }),
    config({ baseUrl: 'http://api.aidesigner.ai' }),
    config({ baseUrl: 'https://user:pw@api.aidesigner.ai' }),
    config({ baseUrl: 'https://api.aidesigner.ai/extra' }),
    config({ baseUrl: 'not a url' }),
  ]) {
    const { calls, fetchImpl } = recorder(reply(200, { sessions: [] }))
    await assert.rejects(createAiDesigner(bad, { fetchImpl }).listSessions(), { code: 'aidesigner-unavailable' })
    assert.equal(calls.length, 0)
  }
})

test('sessions are listed with bearer auth and normalized, dropping bad records', async () => {
  const { calls, fetchImpl } = recorder(reply(200, {
    sessions: [
      { session_id: SESSION, title: 'Landing page', editor_url: 'https://app.aidesigner.ai/editor/' + SESSION, canvas_count: 2, published_url: 'https://coffee.aidesigner.site', updated_at: '2026-07-27T18:06:42.000Z', secret: 'x' },
      { session_id: 'not-a-uuid', title: 'bad' },
      { session_id: CANVAS, title: null, editor_url: 'https://evil.example/editor', canvas_count: -1, published_url: 'javascript:alert(1)' },
    ],
    next_cursor: null,
  }))
  const sessions = await createAiDesigner(config(), { fetchImpl }).listSessions()
  assert.equal(calls[0].url, 'https://api.aidesigner.ai/api/v1/sessions?limit=20')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + KEY)
  assert.equal(calls[0].init.redirect, 'error')
  assert.deepEqual(sessions, [
    { sessionId: SESSION, title: 'Landing page', editorUrl: 'https://app.aidesigner.ai/editor/' + SESSION, canvasCount: 2, publishedUrl: 'https://coffee.aidesigner.site/', updatedAt: '2026-07-27T18:06:42.000Z' },
    { sessionId: CANVAS, title: 'Untitled', editorUrl: null, canvasCount: 0, publishedUrl: null, updatedAt: null },
  ])
})

test('a design is generated into a new session as one JSON reply and only references are returned', async () => {
  const { calls, fetchImpl } = recorder(reply(200,
    { success: true, content: '<!DOCTYPE html><h1>hi</h1>', session_id: SESSION, canvas_id: CANVAS, editor_url: 'https://app.aidesigner.ai/editor/' + SESSION, canvas_delivery: 'appended' },
    { 'x-aidesigner-run-id': RUN }))
  const result = await createAiDesigner(config(), { fetchImpl }).generateDesign({ prompt: 'A homelab status page', viewport: 'mobile', idempotencyKey: 'key-12345678' })
  assert.equal(calls[0].url, 'https://api.aidesigner.ai/api/v1/generateDesign')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    prompt: 'A homelab status page', streaming: false, session: 'new', idempotency_key: 'key-12345678', viewport: 'mobile', design_mode: 'classic',
  })
  assert.deepEqual(result, {
    sessionId: SESSION, canvasId: CANVAS, runId: RUN, editorUrl: 'https://app.aidesigner.ai/editor/' + SESSION,
    canvasDelivery: 'appended', replay: false, htmlBytes: 26,
  })
})

test('an existing session is targeted and headers fill in missing body fields', async () => {
  const { calls, fetchImpl } = recorder(reply(200, { success: true, content: '<p>x</p>', idempotent_replay: true }, {
    'x-aidesigner-session-id': SESSION, 'x-aidesigner-editor-url': 'https://app.aidesigner.ai/editor/' + SESSION, 'x-aidesigner-run-id': RUN,
  }))
  const result = await createAiDesigner(config(), { fetchImpl }).generateDesign({ prompt: 'p', sessionId: SESSION, idempotencyKey: 'key-12345678' })
  assert.equal(JSON.parse(calls[0].init.body).session, SESSION)
  assert.deepEqual(result, { sessionId: SESSION, canvasId: null, runId: RUN, editorUrl: 'https://app.aidesigner.ai/editor/' + SESSION, canvasDelivery: null, replay: true, htmlBytes: 8 })
})

test('provider failures become sanitized error codes', async () => {
  const cases = [
    [reply(401, { error: 'secret detail' }), 'aidesigner-auth-failed'],
    [reply(403, { error: 'no credits' }), 'aidesigner-credits-exhausted'],
    [reply(429, { error: 'slow down' }, { 'retry-after': '42' }), 'aidesigner-rate-limited', 42],
    [reply(429, {}, { 'retry-after': 'soon' }), 'aidesigner-rate-limited', 60],
    [reply(404, {}), 'aidesigner-session-not-found'],
    [reply(409, {}), 'aidesigner-canvas-busy'],
    [reply(400, {}), 'aidesigner-request-rejected'],
    [reply(502, {}), 'aidesigner-unavailable'],
    [reply(200, 'not json'), 'aidesigner-unavailable'],
    [reply(200, { success: false }), 'aidesigner-unavailable'],
    [reply(200, { success: true, content: '<p/>', session_id: 'bad' }), 'aidesigner-unavailable'],
    [() => { throw new Error('network secret') }, 'aidesigner-unavailable'],
  ]
  for (const [response, code, retryAfter] of cases) {
    const { fetchImpl } = recorder(response)
    await assert.rejects(createAiDesigner(config(), { fetchImpl }).generateDesign({ prompt: 'p', idempotencyKey: 'key-12345678' }), (error) => {
      assert.equal(error.code, code)
      assert.doesNotMatch(error.message, /secret/)
      if (retryAfter) assert.equal(error.retryAfter, retryAfter)
      return true
    })
  }
})

test('oversized replies are refused', async () => {
  const { fetchImpl } = recorder(reply(200, JSON.stringify({ success: true, content: 'x'.repeat(5 * 1024 * 1024) })))
  await assert.rejects(createAiDesigner(config(), { fetchImpl }).generateDesign({ prompt: 'p', idempotencyKey: 'key-12345678' }), { code: 'aidesigner-unavailable' })
})
