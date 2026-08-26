import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

async function loadValidator() {
  try {
    return await import('./validate-assistant-session.mjs')
  } catch {
    return {}
  }
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return body ? JSON.parse(body) : {}
}

async function withMockFriday(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  try {
    return await run(baseUrl)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function assistantReply(text, overrides = {}) {
  return {
    available: true,
    mode: 'cloud-ai',
    provider: 'groq',
    model: 'validator-model',
    text,
    fallbackUsed: false,
    attempts: [],
    ...overrides,
  }
}

test('validator forwards completed exchanges and proves current state beats stale history', async () => {
  const validator = await loadValidator()
  assert.equal(typeof validator.runAssistantSessionValidation, 'function')

  const requests = []
  let assistantCall = 0
  const result = await withMockFriday(async (request, response) => {
    if (request.method === 'GET' && request.url === '/api/overview') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ services: [{ id: 'svc-current' }, { id: 'svc-other' }], alerts: [] }))
      return
    }

    if (request.method === 'POST' && request.url === '/api/assistant') {
      const body = await readJson(request)
      requests.push(body)
      assistantCall += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(assistantReply('svc-current')))
      return
    }

    response.writeHead(404)
    response.end()
  }, (baseUrl) => validator.runAssistantSessionValidation({ baseUrl, logger: () => {} }))

  assert.equal(assistantCall, 3)
  assert.deepEqual(requests[0].history, [])
  assert.deepEqual(requests[1].history, [
    { role: 'user', content: requests[0].prompt },
    { role: 'assistant', content: 'svc-current' },
  ])
  assert.equal(requests[2].history.some((message) => message.content.includes('FRIDAY_VALIDATOR_STALE_ID')), true)
  assert.equal(result.grounding.expectedServiceId, 'svc-current')
  assert.equal(result.grounding.staleSentinelRejected, true)
  assert.equal(result.ok, true)
})

test('validator fails when the assistant repeats stale infrastructure context', async () => {
  const validator = await loadValidator()
  assert.equal(typeof validator.runAssistantSessionValidation, 'function')

  let assistantCall = 0
  await assert.rejects(
    withMockFriday(async (request, response) => {
      if (request.method === 'GET' && request.url === '/api/overview') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ services: [{ id: 'svc-current' }] }))
        return
      }

      if (request.method === 'POST' && request.url === '/api/assistant') {
        await readJson(request)
        assistantCall += 1
        const text = assistantCall === 3 ? 'FRIDAY_VALIDATOR_STALE_ID' : 'svc-current'
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(assistantReply(text)))
        return
      }

      response.writeHead(404)
      response.end()
    }, (baseUrl) => validator.runAssistantSessionValidation({ baseUrl, logger: () => {} })),
    /stale history|authoritative/i,
  )
})

test('validator preserves provider provenance and fallback attempts in its report', async () => {
  const validator = await loadValidator()
  assert.equal(typeof validator.runAssistantSessionValidation, 'function')

  const result = await withMockFriday(async (request, response) => {
    if (request.method === 'GET' && request.url === '/api/overview') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ services: [{ id: 'svc-current' }] }))
      return
    }

    if (request.method === 'POST' && request.url === '/api/assistant') {
      await readJson(request)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(assistantReply('svc-current', {
        provider: 'ollama',
        model: 'qwen-validator',
        mode: 'local-ai',
        fallbackUsed: true,
        attempts: [{ provider: 'groq', outcome: 'timeout' }],
      })))
      return
    }

    response.writeHead(404)
    response.end()
  }, (baseUrl) => validator.runAssistantSessionValidation({ baseUrl, logger: () => {} }))

  assert.deepEqual(result.turns[0].provenance, {
    provider: 'ollama',
    model: 'qwen-validator',
    mode: 'local-ai',
    fallbackUsed: true,
    attempts: [{ provider: 'groq', outcome: 'timeout' }],
  })
})
