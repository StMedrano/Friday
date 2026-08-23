import test from 'node:test'
import assert from 'node:assert/strict'
import { askAnthropic } from './anthropic.mjs'
import { ProviderUnavailableError } from './errors.mjs'

test('Anthropic uses Messages API with the shared read-only policy', async () => {
  const result = await askAnthropic({
    providerConfig: { apiKey: 'anthropic-secret', model: 'anthropic-model' },
    prompt: 'Check infrastructure',
    overview: { mode: 'live', services: [] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers['x-api-key'], 'anthropic-secret')
      assert.equal(options.headers['anthropic-version'], '2023-06-01')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'anthropic-model')
      assert.equal(body.max_tokens, 1200)
      assert.match(body.system, /read-only infrastructure copilot/i)
      assert.match(body.messages[0].content, /Check infrastructure/)
      assert.match(body.messages[0].content, /Normalized Friday state/)
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Anthropic answer' }] }), { status: 200 })
    },
  })

  assert.deepEqual(result, { provider: 'anthropic', model: 'anthropic-model', text: 'Anthropic answer' })
})

test('Anthropic normalizes authentication failures', async () => {
  await assert.rejects(
    () => askAnthropic({
      providerConfig: { apiKey: 'bad-secret', model: 'anthropic-model' },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => new Response('{}', { status: 401 }),
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'anthropic' && error.kind === 'authentication',
  )
})

test('Anthropic requires an explicit model', async () => {
  await assert.rejects(
    () => askAnthropic({ providerConfig: { apiKey: 'secret', model: '' }, prompt: 'Check health', overview: {} }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'anthropic' && error.kind === 'configuration',
  )
})
