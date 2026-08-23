import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultProviders } from './providers.mjs'

test('default provider registry exposes exactly the approved AI adapters', () => {
  assert.deepEqual(Object.keys(defaultProviders), ['openai', 'anthropic', 'gemini', 'ollama'])
  for (const provider of Object.values(defaultProviders)) {
    assert.equal(typeof provider, 'function')
  }
  assert.equal(Object.isFrozen(defaultProviders), true)
})
