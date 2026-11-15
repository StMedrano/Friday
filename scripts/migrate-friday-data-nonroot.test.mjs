import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

const script = await readFile(new URL('./migrate-friday-data-nonroot.sh', import.meta.url), 'utf8')
// Commands only: comments and messages may name the steps the operator runs.
const commands = script.split('\n').filter(line => !/^\s*#/.test(line) && !/^\s*(fail|echo) /.test(line) && !/\|\| fail/.test(line)).join('\n')
const overlay = await readFile(new URL('../compose.nonroot.yaml', import.meta.url), 'utf8')
const updater = await readFile(new URL('./update-controller.sh', import.meta.url), 'utf8')
const base = await readFile(new URL('../compose.yaml', import.meta.url), 'utf8')

test('the migration copies from a read-only source into a new volume and never changes friday_data', () => {
  assert.match(script, /--confirm/)
  assert.match(script, /source=\$SOURCE,target=\/old,readonly/)
  assert.match(script, /docker volume create "\$TARGET"/)
  assert.match(script, /already exists/)
  assert.match(script, /is running/)
  assert.match(script, /chown -R 10001:10001 \/new/)
  assert.doesNotMatch(commands, /chown[^\n]*\/old|docker volume (rm|prune)|docker compose (up|down|stop)|docker (restart|stop|kill|rm)\b/)
  assert.doesNotMatch(script, /source=\$SOURCE,target=\/old"/)
})

test('the non-root overlay selects the 10001 image, hardens it and needs the copied volume', () => {
  assert.match(overlay, /target: runtime-nonroot/)
  assert.match(overlay, /user: "10001:10001"/)
  assert.match(overlay, /read_only: true/)
  assert.match(overlay, /- ALL/)
  assert.match(overlay, /- friday_data_nonroot:\/data/)
  assert.match(overlay, /friday_data_nonroot:\n\s+name: friday_data_nonroot\n\s+external: true/)
  // The default stays root on friday_data until the owner opts in.
  assert.doesNotMatch(base, /runtime-nonroot|friday_data_nonroot/)
})

test('the updater adds the overlay only when opted in and the copied volume exists', () => {
  assert.match(updater, /FRIDAY_CONTROLLER_NONROOT/)
  assert.match(updater, /docker volume inspect friday_data_nonroot/)
  assert.match(updater, /EXTRA='-f compose.nonroot.yaml'/)
})
