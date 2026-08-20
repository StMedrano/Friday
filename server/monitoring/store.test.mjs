import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createEmptyMonitoringState } from './state.mjs'
import { createFileMonitoringStore } from './store.mjs'

async function tempStatePath() {
  const dir = await mkdtemp(join(tmpdir(), 'friday-monitoring-'))
  return join(dir, 'monitoring-state.json')
}

test('missing monitoring state loads as empty state', async () => {
  const statePath = await tempStatePath()
  const store = createFileMonitoringStore({ statePath })
  assert.deepEqual(await store.load(), createEmptyMonitoringState())
})

test('legacy monitoring state is normalized on load without losing incidents or history', async () => {
  const statePath = await tempStatePath()
  await writeFile(statePath, JSON.stringify({
    schemaVersion: 1,
    observations: { service: { status: 'offline' } },
    incidents: [{ id: 'i1', status: 'open' }],
    history: [{ id: 'h1', type: 'incident-opened' }],
  }), 'utf8')
  const store = createFileMonitoringStore({ statePath })
  const loaded = await store.load()
  assert.equal(loaded.schemaVersion, 2)
  assert.deepEqual(loaded.diagnostics, {})
  assert.equal(loaded.incidents[0].id, 'i1')
  assert.equal(loaded.history[0].id, 'h1')
})

test('monitoring state survives save and load round trip', async () => {
  const statePath = await tempStatePath()
  const store = createFileMonitoringStore({ statePath })
  const state = createEmptyMonitoringState()
  state.observations.service = { serviceId: 'service', status: 'offline' }
  state.incidents.push({ id: 'x', status: 'open' })
  state.history.push({ id: 'h', type: 'incident-opened' })
  state.diagnostics.x = { id: 'd1', incidentId: 'x', status: 'available' }
  await store.save(state)
  assert.deepEqual(await store.load(), state)
  const mode = (await stat(statePath)).mode & 0o777
  assert.equal(mode, 0o600)
})

test('invalid JSON is quarantined and load returns empty state', async () => {
  const statePath = await tempStatePath()
  await writeFile(statePath, '{bad json', 'utf8')
  const store = createFileMonitoringStore({ statePath })
  assert.deepEqual(await store.load(), createEmptyMonitoringState())
  const files = await readdir(dirname(statePath))
  assert.equal(files.includes('monitoring-state.json'), false)
  assert.equal(files.some((name) => name.startsWith('monitoring-state.json.corrupt-')), true)
})

test('save writes a unique temp file in the same directory then renames it', async () => {
  const statePath = await tempStatePath()
  const calls = []
  const fsImpl = {
    ...fsPromises,
    async writeFile(path, data, options) {
      calls.push(['writeFile', path, options])
      return fsPromises.writeFile(path, data, options)
    },
    async rename(from, to) {
      calls.push(['rename', from, to])
      return fsPromises.rename(from, to)
    },
  }
  const store = createFileMonitoringStore({ statePath, fsImpl })
  await store.save(createEmptyMonitoringState())
  const writeCall = calls.find(([name]) => name === 'writeFile')
  const renameCall = calls.find(([name]) => name === 'rename')
  assert.ok(writeCall[1].startsWith(`${statePath}.tmp-`))
  assert.equal(dirname(writeCall[1]), dirname(statePath))
  assert.equal(writeCall[2].mode, 0o600)
  assert.equal(renameCall[1], writeCall[1])
  assert.equal(renameCall[2], statePath)
})

test('store serializes only the supplied monitoring state', async () => {
  const statePath = await tempStatePath()
  const store = createFileMonitoringStore({ statePath })
  const state = { schemaVersion: 2, observations: {}, incidents: [], history: [], diagnostics: {}, marker: 'safe-state-only' }
  await store.save(state)
  const contents = await readFile(statePath, 'utf8')
  assert.match(contents, /safe-state-only/)
  assert.equal(contents.includes('FRIDAY_VM100_OBSERVER_TOKEN'), false)
  assert.equal(contents.includes('OPENAI_API_KEY'), false)
})
