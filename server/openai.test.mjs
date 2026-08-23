import test from 'node:test'
import assert from 'node:assert/strict'
import { extractResponseText } from './ai/openai.mjs'

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

test('extractResponseText prefers top-level output_text when present', () => {
  assert.equal(extractResponseText({ output_text: 'Direct response text' }), 'Direct response text')
})
