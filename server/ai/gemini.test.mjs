import test from 'node:test'
import assert from 'node:assert/strict'
import { askGemini } from './gemini.mjs'
import { ProviderUnavailableError } from './errors.mjs'

test('Gemini uses generateContent with the shared read-only policy', async () => {
  const result = await askGemini({
    providerConfig: { apiKey: 'gemini-secret', model: 'gemini-model' },
    prompt: 'Check infrastructure',
    overview: { mode: 'live', services: [] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-model:generateContent')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers['x-goog-api-key'], 'gemini-secret')
      const body = JSON.parse(options.body)
      assert.match(body.systemInstruction.parts[0].text, /read-only infrastructure copilot/i)
      assert.match(body.contents[0].parts[0].text, /Check infrastructure/)
      assert.match(body.contents[0].parts[0].text, /Normalized Friday state/)
      assert.equal(body.generationConfig.maxOutputTokens, 1200)
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini answer' }] } }] }), { status: 200 })
    },
  })

  assert.deepEqual(result, { provider: 'gemini', model: 'gemini-model', text: 'Gemini answer' })
})

test('Gemini normalizes upstream failures', async () => {
  await assert.rejects(
    () => askGemini({
      providerConfig: { apiKey: 'gemini-secret', model: 'gemini-model' },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => new Response('{}', { status: 503 }),
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'gemini' && error.kind === 'upstream',
  )
})

test('Gemini requires an explicit model', async () => {
  await assert.rejects(
    () => askGemini({ providerConfig: { apiKey: 'secret', model: '' }, prompt: 'Check health', overview: {} }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'gemini' && error.kind === 'configuration',
  )
})
