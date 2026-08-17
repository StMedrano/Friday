import test from 'node:test'
import assert from 'node:assert/strict'
import { answerAssistant } from './assistant.mjs'

test('assistant stays unavailable unless explicitly enabled', async () => {
  const result = await answerAssistant({
    config: { ai: { enabled: false, apiKey: '', model: 'gpt-5.6-terra' } },
    prompt: 'Check health',
    overview: { mode: 'mock' }
  })

  assert.equal(result.available, false)
  assert.match(result.reason, /disabled/i)
})

test('assistant delegates enabled requests through the provider boundary', async () => {
  const provider = async ({ prompt, overview, apiKey, model }) => ({
    provider: 'openai',
    model,
    text: `${prompt}:${overview.mode}:${apiKey}`
  })

  const result = await answerAssistant({
    config: { ai: { enabled: true, apiKey: 'secret', model: 'gpt-5.6-terra' } },
    prompt: 'Check health',
    overview: { mode: 'live' },
    provider
  })

  assert.equal(result.available, true)
  assert.equal(result.text, 'Check health:live:secret')
})
