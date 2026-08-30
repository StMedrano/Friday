import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelProfile } from './model-profiles.mjs'

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
  })
})

test('returns null for an unknown model profile', () => {
  assert.equal(resolveModelProfile(config, 'missing'), null)
})
