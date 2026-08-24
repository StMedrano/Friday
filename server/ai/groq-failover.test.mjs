import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getConfig } from '../config.mjs'
import { answerAssistant } from '../assistant.mjs'
import { ProviderUnavailableError } from './errors.mjs'
import { askOllama } from './ollama.mjs'

function unavailable(provider, kind) {
  return async () => { throw new ProviderUnavailableError(provider, kind) }
}

test('default AI chain is Groq then Gemini then Ollama with separate timeout budgets', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    GROQ_API_KEY: 'groq-secret',
    GROQ_MODEL: 'groq-model',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-model',
    FRIDAY_LOCAL_AI_ENABLED: 'true',
  })

  assert.deepEqual(config.ai.providerOrder, ['groq', 'gemini', 'ollama'])
  assert.equal(config.ai.cloudTimeoutMs, 15000)
  assert.equal(config.ai.localTimeoutMs, 30000)
  assert.deepEqual(config.ai.providers.groq, { apiKey: 'groq-secret', model: 'groq-model' })
  assert.equal(config.ai.providers.ollama.model, 'qwen3:4b-instruct')
  assert.equal(config.ai.providers.ollama.maxTokens, 512)
})

test('legacy timeout remains a fallback while explicit cloud and local timeouts win', () => {
  const legacy = getConfig({ FRIDAY_AI_REQUEST_TIMEOUT_MS: '22000' })
  assert.equal(legacy.ai.timeoutMs, 22000)
  assert.equal(legacy.ai.cloudTimeoutMs, 22000)
  assert.equal(legacy.ai.localTimeoutMs, 22000)

  const explicit = getConfig({
    FRIDAY_AI_REQUEST_TIMEOUT_MS: '22000',
    FRIDAY_CLOUD_AI_TIMEOUT_MS: '12000',
    FRIDAY_LOCAL_AI_TIMEOUT_MS: '34000',
  })
  assert.equal(explicit.ai.cloudTimeoutMs, 12000)
  assert.equal(explicit.ai.localTimeoutMs, 34000)
})

test('Compose leaves split timeout variables unset by default so legacy timeout fallback survives deployment', async () => {
  const compose = await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8')
  assert.match(compose, /FRIDAY_CLOUD_AI_TIMEOUT_MS:\s*\$\{FRIDAY_CLOUD_AI_TIMEOUT_MS:-\}/)
  assert.match(compose, /FRIDAY_LOCAL_AI_TIMEOUT_MS:\s*\$\{FRIDAY_LOCAL_AI_TIMEOUT_MS:-\}/)
})

test('assistant fails over Groq to Gemini to Ollama and uses provider-specific timeouts', async () => {
  const seenTimeouts = []
  const config = {
    ai: {
      enabled: true,
      providerOrder: ['groq', 'gemini', 'ollama'],
      timeoutMs: 20000,
      cloudTimeoutMs: 15000,
      localTimeoutMs: 30000,
      providers: {
        groq: { apiKey: 'groq-secret', model: 'groq-model' },
        gemini: { apiKey: 'gemini-secret', model: 'gemini-model' },
        ollama: {
          enabled: true,
          baseUrl: 'http://192.168.1.70:11434',
          model: 'qwen3:4b-instruct',
          context: 8192,
          maxTokens: 512,
        },
      },
    },
  }

  const result = await answerAssistant({
    config,
    prompt: 'Check health',
    overview: { mode: 'live' },
    signalFactory: (timeoutMs) => {
      seenTimeouts.push(timeoutMs)
      return { timeoutMs }
    },
    providers: {
      groq: unavailable('groq', 'rate-limited'),
      gemini: unavailable('gemini', 'network'),
      ollama: async () => ({ provider: 'ollama', model: 'qwen3:4b-instruct', text: 'Local GPU answer' }),
    },
  })

  assert.equal(result.mode, 'local-ai')
  assert.equal(result.provider, 'ollama')
  assert.equal(result.model, 'qwen3:4b-instruct')
  assert.deepEqual(result.attempts, [
    { provider: 'groq', outcome: 'rate-limited' },
    { provider: 'gemini', outcome: 'network' },
  ])
  assert.deepEqual(seenTimeouts, [15000, 15000, 30000])
})

test('Groq adapter uses the OpenAI-compatible chat completions endpoint and shared read-only policy', async () => {
  const { askGroq } = await import('./groq.mjs')

  const result = await askGroq({
    providerConfig: { apiKey: 'secret', model: 'model-a' },
    prompt: 'Check health',
    overview: { mode: 'live', services: [] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
      assert.equal(options.headers.Authorization, 'Bearer secret')
      const body = JSON.parse(options.body)
      assert.equal(body.model, 'model-a')
      assert.equal(body.max_completion_tokens, 1200)
      assert.match(body.messages[0].content, /read-only infrastructure copilot/i)
      assert.match(body.messages[1].content, /Check health/)
      assert.match(body.messages[1].content, /Normalized Friday state/)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Groq answer' } }] }), { status: 200 })
    },
  })

  assert.deepEqual(result, { provider: 'groq', model: 'model-a', text: 'Groq answer' })
})

test('Groq rate limits are normalized for sequential failover', async () => {
  const { askGroq } = await import('./groq.mjs')

  await assert.rejects(
    () => askGroq({
      providerConfig: { apiKey: 'secret', model: 'model-a' },
      prompt: 'Check health',
      overview: {},
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'sensitive upstream detail' } }), { status: 429 }),
    }),
    (error) => error instanceof ProviderUnavailableError && error.provider === 'groq' && error.kind === 'rate-limited',
  )
})

test('Ollama receives a bounded local response budget', async () => {
  await askOllama({
    providerConfig: {
      enabled: true,
      baseUrl: 'http://192.168.1.70:11434',
      model: 'qwen3:4b-instruct',
      context: 8192,
      maxTokens: 256,
    },
    prompt: 'Check health',
    overview: { mode: 'live' },
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body)
      assert.equal(body.options.num_ctx, 8192)
      assert.equal(body.options.num_predict, 256)
      return new Response(JSON.stringify({ message: { content: 'Local answer' } }), { status: 200 })
    },
  })
})
