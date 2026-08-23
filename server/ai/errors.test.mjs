import test from 'node:test'
import assert from 'node:assert/strict'
import { ProviderUnavailableError, classifyHttpFailure } from './errors.mjs'

test('provider errors expose only provider and sanitized category', () => {
  const error = new ProviderUnavailableError('openai', 'rate-limited')
  assert.equal(error.provider, 'openai')
  assert.equal(error.kind, 'rate-limited')
  assert.equal(error.name, 'ProviderUnavailableError')
})

test('HTTP availability failures are normalized', () => {
  assert.equal(classifyHttpFailure('openai', 401).kind, 'authentication')
  assert.equal(classifyHttpFailure('openai', 408).kind, 'timeout')
  assert.equal(classifyHttpFailure('openai', 429).kind, 'rate-limited')
  assert.equal(classifyHttpFailure('openai', 503).kind, 'upstream')
})
