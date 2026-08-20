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
