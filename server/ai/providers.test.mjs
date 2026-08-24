import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultProviders } from './providers.mjs'

test('default provider registry exposes primary and retained legacy AI adapters', () => {
  assert.deepEqual(Object.keys(defaultProviders), ['groq', 'gemini', 'ollama', 'openai', 'anthropic'])
  for (const provider of Object.values(defaultProviders)) {
    assert.equal(typeof provider, 'function')
  }
  assert.equal(Object.isFrozen(defaultProviders), true)
})
