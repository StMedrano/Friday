import test from 'node:test'
import assert from 'node:assert/strict'
import { answerAssistant } from './assistant.mjs'
import { ProviderUnavailableError } from './ai/errors.mjs'

function assistantConfig({ enabled = true, order = ['openai', 'anthropic', 'gemini', 'ollama'] } = {}) {
  return {
    ai: {
      enabled,
      providerOrder: order,
      timeoutMs: 1000,
      providers: {
        openai: { apiKey: 'openai-secret', model: 'openai-model' },
        anthropic: { apiKey: 'anthropic-secret', model: 'anthropic-model' },
        gemini: { apiKey: 'gemini-secret', model: 'gemini-model' },
        ollama: { enabled: true, baseUrl: 'http://ollama:11434', model: 'qwen3:4b', context: 8192 },
      },
    },
  }
}

function unavailable(provider, kind) {
  return async () => { throw new ProviderUnavailableError(provider, kind) }
}

test('first configured cloud provider succeeds without fallback', async () => {
  let anthropicCalls = 0
  const result = await answerAssistant({
    config: assistantConfig(),
    prompt: 'Check health',
    overview: { mode: 'live' },
    providers: {
      openai: async () => ({ provider: 'openai', model: 'openai-model', text: 'Cloud answer' }),
      anthropic: async () => { anthropicCalls += 1; return { provider: 'anthropic', model: 'anthropic-model', text: 'unused' } },
    },
  })

  assert.equal(result.available, true)
  assert.equal(result.mode, 'cloud-ai')
  assert.equal(result.provider, 'openai')
  assert.equal(result.text, 'Cloud answer')
  assert.equal(result.fallbackUsed, false)
  assert.deepEqual(result.attempts, [])
  assert.equal(anthropicCalls, 0)
})

test('successful AI provider receives sanitized conversation history', async () => {
  const history = [
    { role: 'user', content: 'Check friday-ollama' },
    { role: 'assistant', content: 'friday-ollama is LXC 108' },
  ]
  let seenHistory

  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai'] }),
    prompt: 'Compare it to VM102',
    history,
    overview: { mode: 'live' },
    providers: {
      openai: async (input) => {
        seenHistory = input.history
        return { provider: 'openai', model: 'openai-model', text: 'Comparison' }
      },
    },
  })

  assert.equal(result.provider, 'openai')
  assert.deepEqual(seenHistory, history)
})

test('availability failure falls through sequentially and records only sanitized attempts', async () => {
  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai', 'anthropic'] }),
    prompt: 'Check health',
    overview: { mode: 'live' },
    providers: {
      openai: unavailable('openai', 'rate-limited'),
      anthropic: async () => ({ provider: 'anthropic', model: 'anthropic-model', text: 'Fallback cloud answer' }),
    },
  })

  assert.equal(result.provider, 'anthropic')
  assert.equal(result.mode, 'cloud-ai')
  assert.equal(result.fallbackUsed, true)
  assert.deepEqual(result.attempts, [{ provider: 'openai', outcome: 'rate-limited' }])
})

test('conversation history survives sequential provider failover unchanged', async () => {
  const history = [
    { role: 'user', content: 'Check VM102' },
    { role: 'assistant', content: 'VM102 is online' },
  ]
  let secondProviderHistory

  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai', 'anthropic'] }),
    prompt: 'What about friday-ollama?',
    history,
    overview: { mode: 'live' },
    providers: {
      openai: unavailable('openai', 'timeout'),
      anthropic: async (input) => {
        secondProviderHistory = input.history
        return { provider: 'anthropic', model: 'anthropic-model', text: 'Fallback answer' }
      },
    },
  })

  assert.equal(result.provider, 'anthropic')
  assert.equal(result.fallbackUsed, true)
  assert.deepEqual(result.attempts, [{ provider: 'openai', outcome: 'timeout' }])
  assert.deepEqual(secondProviderHistory, history)
})

test('Ollama success is labeled local AI', async () => {
  const result = await answerAssistant({
    config: assistantConfig({ order: ['ollama'] }),
    prompt: 'Check health',
    overview: {},
    providers: {
      ollama: async () => ({ provider: 'ollama', model: 'qwen3:4b', text: 'Local answer' }),
    },
  })

  assert.equal(result.available, true)
  assert.equal(result.mode, 'local-ai')
  assert.equal(result.provider, 'ollama')
  assert.equal(result.text, 'Local answer')
})

test('all AI providers unavailable falls back to deterministic local analysis when supported', async () => {
  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai', 'ollama'] }),
    prompt: 'show service status',
    overview: {},
    providers: {
      openai: unavailable('openai', 'network'),
      ollama: unavailable('ollama', 'network'),
    },
    previewImpl: () => ({ accepted: true, mode: 'preview', command: 'service-status', destructive: false, requiresApproval: false, message: 'Preview only: service-status would run read-only checks.' }),
  })

  assert.deepEqual(result, {
    available: true,
    mode: 'local-analysis',
    provider: 'deterministic',
    model: null,
    text: 'Preview only: service-status would run read-only checks.',
    fallbackUsed: true,
    attempts: [
      { provider: 'openai', outcome: 'network' },
      { provider: 'ollama', outcome: 'network' },
    ],
  })
})

test('deterministic local analysis receives only the current prompt, not conversation history', async () => {
  const history = [
    { role: 'user', content: 'Check friday-ollama' },
    { role: 'assistant', content: 'friday-ollama is LXC 108' },
  ]
  let previewInput

  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai'] }),
    prompt: 'show service status',
    history,
    overview: {},
    providers: { openai: unavailable('openai', 'network') },
    previewImpl: (input) => {
      previewInput = input
      return { accepted: true, mode: 'preview', command: 'service-status', destructive: false, requiresApproval: false, message: 'Preview only' }
    },
  })

  assert.equal(result.mode, 'local-analysis')
  assert.deepEqual(previewInput, { message: 'show service status' })
  assert.equal(Object.hasOwn(previewInput, 'history'), false)
})

test('exhausted AI and unsupported deterministic intent returns unavailable', async () => {
  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai'] }),
    prompt: 'tell me something unrelated',
    overview: {},
    providers: { openai: unavailable('openai', 'upstream') },
    previewImpl: () => ({ accepted: false, mode: 'preview', reason: 'unsupported-command' }),
  })

  assert.equal(result.available, false)
  assert.equal(result.mode, 'local-analysis')
  assert.equal(result.provider, 'deterministic')
  assert.equal(result.model, null)
  assert.equal(result.fallbackUsed, true)
  assert.deepEqual(result.attempts, [{ provider: 'openai', outcome: 'upstream' }])
  assert.match(result.reason, /No configured AI provider was available/i)
})

test('ordinary model refusal is returned immediately and does not fail over', async () => {
  let anthropicCalls = 0
  const result = await answerAssistant({
    config: assistantConfig({ order: ['openai', 'anthropic'] }),
    prompt: 'Change the firewall',
    overview: {},
    providers: {
      openai: async () => ({ provider: 'openai', model: 'openai-model', text: 'I cannot perform infrastructure-changing actions.' }),
      anthropic: async () => { anthropicCalls += 1; return { provider: 'anthropic', model: 'anthropic-model', text: 'unused' } },
    },
  })

  assert.equal(result.provider, 'openai')
  assert.match(result.text, /cannot perform/i)
  assert.equal(anthropicCalls, 0)
})

test('blank prompt is rejected before any provider access', async () => {
  let calls = 0
  const result = await answerAssistant({
    config: assistantConfig(),
    prompt: '   ',
    overview: {},
    providers: { openai: async () => { calls += 1; return { provider: 'openai', model: 'x', text: 'unused' } } },
  })

  assert.deepEqual(result, { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' })
  assert.equal(calls, 0)
})

test('AI disabled skips providers but still permits deterministic read-only analysis', async () => {
  let calls = 0
  const result = await answerAssistant({
    config: assistantConfig({ enabled: false }),
    prompt: 'network overview',
    overview: {},
    providers: { openai: async () => { calls += 1; return { provider: 'openai', model: 'x', text: 'unused' } } },
    previewImpl: () => ({ accepted: true, mode: 'preview', command: 'network-overview', destructive: false, requiresApproval: false, message: 'Preview only: network-overview would run read-only checks.' }),
  })

  assert.equal(calls, 0)
  assert.equal(result.available, true)
  assert.equal(result.mode, 'local-analysis')
  assert.equal(result.provider, 'deterministic')
  assert.equal(result.fallbackUsed, false)
})

test('unconfigured providers are skipped instead of treated as failed attempts', async () => {
  const config = assistantConfig({ order: ['openai', 'anthropic'] })
  config.ai.providers.openai.apiKey = ''
  const result = await answerAssistant({
    config,
    prompt: 'Check health',
    overview: {},
    providers: {
      openai: async () => { throw new Error('must not be called') },
      anthropic: async () => ({ provider: 'anthropic', model: 'anthropic-model', text: 'Configured provider' }),
    },
  })

  assert.equal(result.provider, 'anthropic')
  assert.equal(result.fallbackUsed, false)
  assert.deepEqual(result.attempts, [])
})
