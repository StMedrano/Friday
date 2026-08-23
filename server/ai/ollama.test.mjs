import test from 'node:test'
import assert from 'node:assert/strict'
import { askOllama } from './ollama.mjs'
import { ProviderUnavailableError } from './errors.mjs'

test('Ollama uses private chat API with shared policy and configured context', async () => {
  const result = await askOllama({
    providerConfig: { enabled: true, baseUrl: 'http://ollama:11434', model: 'qwen3:4b', context: 8192 },
    prompt: 'Check health',
    overview: { mode: 'live', services: [] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://ollama:11434/api/chat')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers['content-type'], 'application/json')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'qwen3:4b')
      assert.equal(body.stream, false)
      assert.equal(body.options.num_ctx, 8192)
      assert.match(body.messages[0].content, /read-only infrastructure copilot/i)
      assert.match(body.messages[1].content, /Check health/)
      assert.match(body.messages[1].content, /Normalized Friday state/)
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'Local answer' }, done: true }), { status: 200 })
    },
  })

  assert.deepEqual(result, { provider: 'ollama', model: 'qwen3:4b', text: 'Local answer' })
})

test('Ollama disabled state is a configuration availability failure', async () => {
  await assert.rejects(
    () => askOllama({
      providerConfig: { enabled: false, baseUrl: 'http://ollama:11434', model: 'qwen3:4b', context: 8192 },
      prompt: 'Check health',
      overview: {},
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'ollama' && error.kind === 'configuration',
  )
})

test('Ollama network failures are normalized for deterministic fallback', async () => {
  await assert.rejects(
    () => askOllama({
      providerConfig: { enabled: true, baseUrl: 'http://ollama:11434', model: 'qwen3:4b', context: 8192 },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => { throw new Error('connect ECONNREFUSED with internal detail') },
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'ollama' && error.kind === 'network',
  )
})

test('Ollama empty output is an invalid response availability failure', async () => {
  await assert.rejects(
    () => askOllama({
      providerConfig: { enabled: true, baseUrl: 'http://ollama:11434', model: 'qwen3:4b', context: 8192 },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => new Response(JSON.stringify({ message: { content: '' }, done: true }), { status: 200 }),
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'ollama' && error.kind === 'invalid-response',
  )
})
