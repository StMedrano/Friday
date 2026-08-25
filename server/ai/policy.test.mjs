import test from 'node:test'
import assert from 'node:assert/strict'
import { fridaySystemPrompt } from './policy.mjs'

test('shared assistant policy is explicitly read-only and state-grounded', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /read-only infrastructure copilot/i)
  assert.match(prompt, /normalized infrastructure state/i)
  assert.match(prompt, /do not claim.*executed/i)
  assert.match(prompt, /do not invent/i)
})

test('shared assistant policy preserves exact infrastructure identifiers and mappings', () => {
  const prompt = fridaySystemPrompt()
  assert.match(prompt, /preserve exact.*service ids/i)
  assert.match(prompt, /vm\/lxc numbers/i)
  assert.match(prompt, /service-name mappings/i)
  assert.match(prompt, /never infer.*renumber.*substitute/i)
})
