import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from './config.mjs'

test('AI config exposes the Groq Gemini Ollama chain and keeps credentials server-side', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    FRIDAY_AI_PROVIDER_ORDER: 'groq,gemini,ollama',
    FRIDAY_CLOUD_AI_TIMEOUT_MS: '15000',
    FRIDAY_LOCAL_AI_TIMEOUT_MS: '30000',
    GROQ_API_KEY: 'groq-secret',
    GROQ_MODEL: 'groq-model',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-model',
    FRIDAY_LOCAL_AI_ENABLED: 'true',
    FRIDAY_LOCAL_AI_URL: 'http://192.168.1.70:11434',
    FRIDAY_LOCAL_AI_MODEL: 'qwen3:4b-instruct',
    FRIDAY_LOCAL_AI_CONTEXT: '8192',
    FRIDAY_LOCAL_AI_MAX_TOKENS: '512',
  })

  assert.equal(config.ai.enabled, true)
  assert.deepEqual(config.ai.providerOrder, ['groq', 'gemini', 'ollama'])
  assert.equal(config.ai.cloudTimeoutMs, 15000)
  assert.equal(config.ai.localTimeoutMs, 30000)
  assert.deepEqual(config.ai.providers.groq, { apiKey: 'groq-secret', model: 'groq-model' })
  assert.deepEqual(config.ai.providers.gemini, { apiKey: 'gemini-secret', model: 'gemini-model' })
  assert.deepEqual(config.ai.providers.ollama, {
    enabled: true,
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 512,
  })
})

test('AI provider order drops unknown and duplicate provider ids while retaining optional legacy adapters', () => {
  const config = getConfig({ FRIDAY_AI_PROVIDER_ORDER: 'gemini,unknown,groq,gemini,openai' })
  assert.deepEqual(config.ai.providerOrder, ['gemini', 'groq', 'openai'])
})

test('cloud providers require explicit models while OpenAI keeps its legacy default', () => {
  const config = getConfig({})
  assert.equal(config.ai.enabled, false)
  assert.equal(config.ai.providers.groq.model, '')
  assert.equal(config.ai.providers.gemini.model, '')
  assert.equal(config.ai.providers.openai.model, 'gpt-5.6-terra')
  assert.equal(config.ai.providers.anthropic.model, '')
  assert.equal(config.ai.providers.ollama.enabled, false)
  assert.equal(config.ai.providers.ollama.model, 'qwen3:4b-instruct')
  assert.equal(config.ai.providers.ollama.context, 8192)
  assert.equal(config.ai.providers.ollama.maxTokens, 512)
})

test('agent model profiles stay local-only and server-side', () => {
  const config = getConfig({
    FRIDAY_AGENT_REGISTRY_ENABLED: 'true',
    FRIDAY_AGENT_LOCAL_GENERAL_URL: 'http://192.168.1.70:11434',
    FRIDAY_AGENT_LOCAL_GENERAL_MODEL: 'qwen3:4b-instruct',
    FRIDAY_AGENT_LOCAL_GENERAL_CONTEXT: '8192',
    FRIDAY_AGENT_LOCAL_GENERAL_MAX_TOKENS: '768',
  })

  assert.equal(config.agents.enabled, true)
  assert.deepEqual(config.agents.modelProfiles['local-general'], {
    provider: 'ollama',
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 768,
  })
  assert.equal('apiKey' in config.agents.modelProfiles['local-general'], false)
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
