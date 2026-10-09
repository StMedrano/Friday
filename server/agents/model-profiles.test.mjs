import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelProfile } from './model-profiles.mjs'
import { getConfig } from '../config.mjs'

const config = {
  agents: {
    modelProfiles: {
      'local-general': {
        provider: 'ollama',
        baseUrl: 'http://192.168.1.70:11434',
        model: 'qwen3:4b-instruct',
        context: 8192,
        maxTokens: 768,
      },
    },
  },
}

test('resolves a named local Ollama model profile', () => {
  assert.deepEqual(resolveModelProfile(config, 'local-general'), {
    id: 'local-general',
    provider: 'ollama',
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 768,
    timeoutMs: 90000,
  })
})

test('returns null for an unknown model profile', () => {
  assert.equal(resolveModelProfile(config, 'missing'), null)
})

test('local profiles have bounded configurable routing and inference budgets', () => {
  const defaults = getConfig({})
  assert.equal(resolveModelProfile(defaults, 'local-router').timeoutMs, 15000)
  assert.equal(resolveModelProfile(defaults, 'local-general').timeoutMs, 90000)
  assert.equal(resolveModelProfile(defaults, 'local-coder').timeoutMs, 90000)
  const configured = getConfig({ FRIDAY_AGENT_LOCAL_GENERAL_TIMEOUT_MS: '120000' })
  assert.equal(resolveModelProfile(configured, 'local-general').timeoutMs, 120000)
})
