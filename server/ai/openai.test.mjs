import test from 'node:test'
import assert from 'node:assert/strict'
import { askOpenAI } from './openai.mjs'
import { ProviderUnavailableError } from './errors.mjs'

test('OpenAI uses the shared provider contract and Responses API with recent context', async () => {
  let providerText = ''
  const result = await askOpenAI({
    providerConfig: { apiKey: 'secret', model: 'model-a' },
    prompt: 'Check health',
    history: [
      { role: 'user', content: 'Check friday-ollama' },
      { role: 'assistant', content: 'friday-ollama is LXC 108' },
    ],
    overview: { mode: 'live', services: [] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses')
      assert.equal(options.headers.Authorization, 'Bearer secret')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'model-a')
      assert.match(body.input[0].content, /read-only infrastructure copilot/i)
      providerText = body.input[1].content
      return new Response(JSON.stringify({ output_text: 'OpenAI answer' }), { status: 200 })
    },
  })

  assert.match(providerText, /Recent session context:/)
  assert.match(providerText, /Check friday-ollama/)
  assert.match(providerText, /Current operator request:\nCheck health/)
  assert.match(providerText, /Authoritative normalized Friday state:/)
  assert.deepEqual(result, { provider: 'openai', model: 'model-a', text: 'OpenAI answer' })
})

test('OpenAI normalizes rate limits for failover', async () => {
  await assert.rejects(
    () => askOpenAI({
      providerConfig: { apiKey: 'secret', model: 'model-a' },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'sensitive upstream detail' } }), { status: 429 }),
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'openai' && error.kind === 'rate-limited',
  )
})

test('OpenAI reports missing credentials as provider configuration failure', async () => {
  await assert.rejects(
    () => askOpenAI({ providerConfig: { apiKey: '', model: 'model-a' }, prompt: 'Check health', overview: {} }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'openai' && error.kind === 'configuration',
  )
})
