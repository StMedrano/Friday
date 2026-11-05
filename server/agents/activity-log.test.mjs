import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentActivityLog } from './activity-log.mjs'

const tempPath = async () => join(await mkdtemp(join(tmpdir(), 'friday-activity-')), 'agent-activity.json')

test('records metadata only, newest first, and never the prompt or answer', async () => {
  const path = await tempPath()
  let time = Date.parse('2026-11-05T10:00:00.000Z')
  const log = await createAgentActivityLog({ path, now: () => time })
  await log.record({ agentId: 'homelab', result: { available: true, agentName: 'HomeLab', provider: 'ollama', model: 'qwen3:4b', modelProfile: 'local-small', text: 'secret answer' }, durationMs: 1234.6 })
  time += 60_000
  await log.record({ agentId: 'ghost', result: { available: false, error: 'agent-unavailable' }, durationMs: 3 })
  time += 60_000
  await log.record({ agentId: 'homelab', result: { available: false, error: 'local-agent-unavailable', agentName: 'HomeLab', code: 'FRIDAY_AGENT_GROUNDING_INVALID' }, durationMs: 50 })
  await log.record({ agentId: 'homelab', error: new Error('boom with prompt text'), durationMs: 7 })

  const events = log.list()
  assert.deepEqual(events.map((event) => [event.agentId, event.outcome]), [
    ['homelab', 'failed'], ['homelab', 'unavailable'], ['ghost', 'not-found'], ['homelab', 'answered'],
  ])
  assert.deepEqual(events.at(-1), {
    id: events.at(-1).id, at: '2026-11-05T10:00:00.000Z', agentId: 'homelab', agentName: 'HomeLab',
    outcome: 'answered', provider: 'ollama', model: 'qwen3:4b', modelProfile: 'local-small', durationMs: 1235,
  })
  assert.equal(events[1].reason, 'grounding-invalid')
  const stored = await readFile(path, 'utf8')
  assert.doesNotMatch(stored, /secret answer|prompt text|boom/)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('survives a restart, keeps a bounded window and drops malformed stored entries', async () => {
  const path = await tempPath()
  const first = await createAgentActivityLog({ path, limit: 3, now: () => Date.parse('2026-11-05T10:00:00.000Z') })
  for (let index = 0; index < 5; index += 1) await first.record({ agentId: `a${index}`, result: { available: true }, durationMs: 1 })
  const reloaded = await createAgentActivityLog({ path, limit: 3 })
  assert.deepEqual(reloaded.list().map((event) => event.agentId), ['a4', 'a3', 'a2'])

  await writeFile(path, JSON.stringify({ schemaVersion: 1, events: [{ id: 'x' }, 'bad', { id: 'ok', at: '2026-11-05T10:00:00.000Z', agentId: 'a', outcome: 'answered', durationMs: 1 }] }))
  assert.deepEqual((await createAgentActivityLog({ path })).list().map((event) => event.id), ['ok'])
  await writeFile(path, 'not json')
  assert.deepEqual((await createAgentActivityLog({ path })).list(), [])
})

test('a failed write never throws to the caller', async () => {
  const blocker = await tempPath()
  await writeFile(blocker, 'a file, not a directory')
  const log = await createAgentActivityLog({ path: join(blocker, 'agent-activity.json') })
  await log.record({ agentId: 'a', result: { available: true }, durationMs: 1 })
  assert.equal(log.list().length, 1)
})
