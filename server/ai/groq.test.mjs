import test from 'node:test'
import assert from 'node:assert/strict'
import { askGroq } from './groq.mjs'

test('Groq includes recent session context in the shared provider-facing prompt', async () => {
  let providerText = ''
  const result = await askGroq({
    providerConfig: { apiKey: 'groq-secret', model: 'groq-model' },
    prompt: 'Compare it to VM102',
    history: [
      { role: 'user', content: 'Check friday-ollama' },
      { role: 'assistant', content: 'friday-ollama is LXC 108' },
    ],
    overview: { services: [{ name: 'friday-ollama', host: 'LXC 108' }] },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions')
      const body = JSON.parse(options.body)
      providerText = body.messages[1].content
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Groq answer' } }] }), { status: 200 })
    },
  })

  assert.match(providerText, /Recent session context:/)
  assert.match(providerText, /Check friday-ollama/)
  assert.match(providerText, /Current operator request:/)
  assert.match(providerText, /Authoritative normalized Friday state:/)
  assert.deepEqual(result, { provider: 'groq', model: 'groq-model', text: 'Groq answer' })
})
