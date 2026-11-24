import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'

const script = new URL('./arm-automation-gate.sh', import.meta.url).pathname

test('arm-automation-gate refuses anything but 1-5 minutes or close, before touching Docker', () => {
  for (const arg of ['0', '6', '10', '-1', 'open', '5m']) {
    const result = spawnSync('/bin/sh', [script, arg], {encoding: 'utf8', env: {PATH: '/nonexistent'}})
    assert.equal(result.status, 2, arg)
    assert.match(result.stderr, /Usage/)
  }
})

test('arm-automation-gate writes the exact gate shape, owner-only, at most 5 minutes ahead', () => {
  const body = readFileSync(script, 'utf8')
  assert.match(body, /state: "allow-approved-actions"/)
  assert.match(body, /mode: 0o700/)
  assert.match(body, /mode: 0o600/)
  assert.match(body, /minutes \* 60 \* 1000 - 1000/)
  assert.match(body, /docker compose exec -T/)
})
