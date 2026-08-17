import test from 'node:test'
import assert from 'node:assert/strict'
import { askOpenAI, extractResponseText } from './ai/openai.mjs'

test('extractResponseText reads Responses API output_text content', () => {
  const text = extractResponseText({
    output: [
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'VM 100 is healthy.' }
        ]
      }
    ]
  })

  assert.equal(text, 'VM 100 is healthy.')
})

test('askOpenAI keeps the API key in the server request and returns text', async () => {
  let request
  const fakeFetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      async json() {
        return {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'No critical issues found.' }]
            }
          ]
        }
      }
    }
  }

  const result = await askOpenAI({
    apiKey: 'server-secret',
    model: 'gpt-5.6-terra',
    prompt: 'Check the homelab.',
    overview: { mode: 'mock', sites: [], services: [], alerts: [] },
    fetchImpl: fakeFetch
  })

  assert.equal(result.text, 'No critical issues found.')
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.options.headers.Authorization, 'Bearer server-secret')
  assert.equal(JSON.parse(request.options.body).model, 'gpt-5.6-terra')
})

test('askOpenAI refuses to run without a server API key', async () => {
  await assert.rejects(
    () => askOpenAI({ prompt: 'Check health', overview: {} }),
    /OPENAI_API_KEY is not configured/
  )
})
