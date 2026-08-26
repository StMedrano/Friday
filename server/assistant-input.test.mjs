import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_PROMPT_CHARS,
  normalizeAssistantHistory,
  validateAssistantPrompt,
} from './assistant-input.mjs'

test('validateAssistantPrompt rejects empty input', () => {
  const result = validateAssistantPrompt('   ')
  assert.equal(result.ok, false)
  assert.equal(result.result.available, false)
  assert.equal(result.result.error, 'invalid-prompt')
  assert.match(result.result.reason, /required/i)
})

test('validateAssistantPrompt accepts exactly 4000 trimmed characters', () => {
  const prompt = 'x'.repeat(MAX_PROMPT_CHARS)
  const result = validateAssistantPrompt(`  ${prompt}  `)
  assert.equal(result.ok, true)
  assert.equal(result.prompt, prompt)
  assert.equal(result.prompt.length, 4000)
})

test('validateAssistantPrompt rejects prompt longer than 4000 characters', () => {
  const result = validateAssistantPrompt('x'.repeat(MAX_PROMPT_CHARS + 1))
  assert.equal(result.ok, false)
  assert.equal(result.result.error, 'invalid-prompt')
  assert.match(result.result.reason, /too long/i)
})

test('assistant input limits match the approved contract', () => {
  assert.equal(MAX_PROMPT_CHARS, 4000)
  assert.equal(MAX_HISTORY_MESSAGES, 20)
  assert.equal(MAX_HISTORY_MESSAGE_CHARS, 2000)
  assert.equal(MAX_HISTORY_TOTAL_CHARS, 12000)
})

test('normalizeAssistantHistory returns empty history for non-array input', () => {
  assert.deepEqual(normalizeAssistantHistory(null), [])
  assert.deepEqual(normalizeAssistantHistory({ role: 'user', content: 'hello' }), [])
})

test('normalizeAssistantHistory discards invalid roles and empty content', () => {
  const result = normalizeAssistantHistory([
    { role: 'system', content: 'ignore me' },
    { role: 'user', content: '   ' },
    { role: 'assistant', content: null },
    { role: 'user', content: '  Check VM102  ' },
    { role: 'assistant', content: '  VM102 is online  ' },
  ])

  assert.deepEqual(result, [
    { role: 'user', content: 'Check VM102' },
    { role: 'assistant', content: 'VM102 is online' },
  ])
})

test('normalizeAssistantHistory truncates each historical message to 2000 characters', () => {
  const result = normalizeAssistantHistory([
    { role: 'user', content: 'x'.repeat(MAX_HISTORY_MESSAGE_CHARS + 250) },
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].content.length, 2000)
})

test('normalizeAssistantHistory keeps the newest 20 valid messages', () => {
  const history = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `message-${index}`,
  }))

  const normalized = normalizeAssistantHistory(history)
  assert.equal(normalized.length, 20)
  assert.equal(normalized[0].content, 'message-4')
  assert.equal(normalized.at(-1).content, 'message-23')
})

test('normalizeAssistantHistory drops oldest messages until total content is at most 12000 characters', () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}`.repeat(2000),
  }))

  const normalized = normalizeAssistantHistory(history)
  const total = normalized.reduce((sum, message) => sum + message.content.length, 0)

  assert.equal(normalized.length, 6)
  assert.equal(total, MAX_HISTORY_TOTAL_CHARS)
  assert.equal(normalized[0].content[0], '2')
  assert.equal(normalized.at(-1).content[0], '7')
})

test('normalizeAssistantHistory preserves order after sanitizing and bounding', () => {
  const normalized = normalizeAssistantHistory([
    { role: 'assistant', content: 'first' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'third' },
  ])

  assert.deepEqual(normalized.map((item) => item.content), ['first', 'second', 'third'])
})
