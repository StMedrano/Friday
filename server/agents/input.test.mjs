import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAgentId, validateAgentPrompt, validateRegistrySyncBody } from './input.mjs'

test('agent prompt accepts exactly 4000 trimmed characters and rejects empty or longer input', () => {
  assert.deepEqual(validateAgentPrompt(`  ${'x'.repeat(4000)}  `), { ok: true, prompt: 'x'.repeat(4000) })
  assert.deepEqual(validateAgentPrompt('   '), {
    ok: false,
    result: { available: false, error: 'invalid-prompt', reason: 'A prompt is required.' },
  })
  const tooLong = validateAgentPrompt('x'.repeat(4001))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.result.error, 'invalid-prompt')
  assert.match(tooLong.result.reason, /too long/i)
})

test('agent id accepts bounded machine ids and rejects path/query/control forms', () => {
  assert.deepEqual(validateAgentId('proxmox-observer'), { ok: true, id: 'proxmox-observer' })
  for (const value of ['', '../root', 'agent/a', 'agent?a', 'x'.repeat(129), 'agent id']) {
    assert.equal(validateAgentId(value).ok, false, value)
  }
})

test('registry sync body permits only an empty object', () => {
  assert.deepEqual(validateRegistrySyncBody({}), { ok: true })
  for (const value of [null, [], { force: true }, { agent: 'x' }]) {
    assert.equal(validateRegistrySyncBody(value).ok, false)
  }
})
