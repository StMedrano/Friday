import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from './config.mjs'

test('AI stays disabled by default and keeps OpenAI credentials server-side', () => {
  const config = getConfig({})
  assert.equal(config.ai.enabled, false)
  assert.equal(config.ai.apiKey, '')
  assert.equal(config.ai.model, 'gpt-5.6-terra')
})

test('AI config requires explicit enable flag', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    OPENAI_API_KEY: 'secret',
    OPENAI_MODEL: 'gpt-5.6-sol'
  })
  assert.equal(config.ai.enabled, true)
  assert.equal(config.ai.apiKey, 'secret')
  assert.equal(config.ai.model, 'gpt-5.6-sol')
})
