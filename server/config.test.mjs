import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from './config.mjs'

test('AI config exposes ordered cloud and local providers without browser-facing secrets', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    FRIDAY_AI_PROVIDER_ORDER: 'openai,anthropic,gemini,ollama',
    FRIDAY_AI_REQUEST_TIMEOUT_MS: '15000',
    OPENAI_API_KEY: 'openai-secret',
    OPENAI_MODEL: 'openai-model',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    ANTHROPIC_MODEL: 'anthropic-model',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-model',
    FRIDAY_LOCAL_AI_ENABLED: 'true',
    FRIDAY_LOCAL_AI_URL: 'http://ollama:11434',
    FRIDAY_LOCAL_AI_MODEL: 'qwen3:4b',
    FRIDAY_LOCAL_AI_CONTEXT: '8192',
  })

  assert.equal(config.ai.enabled, true)
  assert.deepEqual(config.ai.providerOrder, ['openai', 'anthropic', 'gemini', 'ollama'])
  assert.equal(config.ai.timeoutMs, 15000)
  assert.deepEqual(config.ai.providers.openai, { apiKey: 'openai-secret', model: 'openai-model' })
  assert.deepEqual(config.ai.providers.anthropic, { apiKey: 'anthropic-secret', model: 'anthropic-model' })
  assert.deepEqual(config.ai.providers.gemini, { apiKey: 'gemini-secret', model: 'gemini-model' })
  assert.deepEqual(config.ai.providers.ollama, {
    enabled: true,
    baseUrl: 'http://ollama:11434',
    model: 'qwen3:4b',
    context: 8192,
  })
})

test('AI provider order drops unknown and duplicate provider ids', () => {
  const config = getConfig({ FRIDAY_AI_PROVIDER_ORDER: 'gemini,unknown,gemini,openai' })
  assert.deepEqual(config.ai.providerOrder, ['gemini', 'openai'])
})

test('new cloud providers require an explicit model while OpenAI keeps the existing default', () => {
  const config = getConfig({})
  assert.equal(config.ai.enabled, false)
  assert.equal(config.ai.providers.openai.model, 'gpt-5.6-terra')
  assert.equal(config.ai.providers.anthropic.model, '')
  assert.equal(config.ai.providers.gemini.model, '')
  assert.equal(config.ai.providers.ollama.enabled, false)
  assert.equal(config.ai.providers.ollama.model, 'qwen3:4b')
  assert.equal(config.ai.providers.ollama.context, 8192)
})

test('VM100 observer config is disabled by default and stays server-side', () => {
  const defaults = getConfig({})
  assert.equal(defaults.vm100Observer.enabled, false)
  assert.equal(defaults.vm100Observer.baseUrl, '')
  assert.equal(defaults.vm100Observer.token, '')
  assert.equal(defaults.vm100Observer.hostName, 'VM 100')

  const config = getConfig({
    FRIDAY_VM100_OBSERVER_ENABLED: 'true',
    FRIDAY_VM100_OBSERVER_URL: 'http://192.168.1.124:3199',
    FRIDAY_VM100_OBSERVER_TOKEN: 'observer-secret',
    FRIDAY_VM100_OBSERVER_HOST_NAME: 'VM 100',
  })
  assert.equal(config.vm100Observer.enabled, true)
  assert.equal(config.vm100Observer.baseUrl, 'http://192.168.1.124:3199')
  assert.equal(config.vm100Observer.token, 'observer-secret')
  assert.equal(config.vm100Observer.hostName, 'VM 100')
})

test('diagnostics are disabled by default and require explicit opt-in', () => {
  assert.deepEqual(getConfig({}).diagnostics, { enabled: false })
  assert.deepEqual(getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'true' }).diagnostics, { enabled: true })
  assert.deepEqual(getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'false' }).diagnostics, { enabled: false })
})
