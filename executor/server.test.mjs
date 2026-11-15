import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDockerEngine, createExecutorServer, loadAllowlist, parseAllowlist } from './server.mjs'

const token = 'x'.repeat(40)
const auth = { authorization: `Bearer ${token}` }

async function withExecutor(t, fn, { engine } = {}) {
  const calls = []
  const logs = []
  const fake = engine || { state: async (name) => { calls.push(['state', name]); return 'running' }, act: async (name, op) => { calls.push(['act', name, op]) } }
  const server = createExecutorServer({ config: { token }, allowlist: parseAllowlist({ schemaVersion: 1, containers: [{ name: 'plex', operations: ['restart', 'stop'] }] }),
    engine: fake, log: (line) => logs.push(line) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  await fn(`http://127.0.0.1:${server.address().port}`, { calls, logs })
}

test('the allowlist accepts only start, stop and restart for named containers', () => {
  assert.equal(parseAllowlist({ schemaVersion: 1, containers: [{ name: 'plex', operations: ['restart'] }] }).get('plex').has('restart'), true)
  for (const bad of [
    { schemaVersion: 1, containers: [{ name: 'plex', operations: ['exec'] }] },
    { schemaVersion: 1, containers: [{ name: 'plex', operations: ['kill'] }] },
    { schemaVersion: 1, containers: [{ name: '../plex', operations: ['restart'] }] },
    { schemaVersion: 1, containers: [{ name: 'plex', operations: [] }] },
    { schemaVersion: 1, containers: [{ name: 'plex', operations: ['restart'], image: 'x' }] },
    { schemaVersion: 2, containers: [] },
  ]) assert.throws(() => parseAllowlist(bad), /invalid-allowlist/)
})

test('the allowlist file must be owner-written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-executor-'))
  const path = join(dir, 'allowlist.json')
  await writeFile(path, JSON.stringify({ schemaVersion: 1, containers: [] }), { mode: 0o644 })
  assert.equal(loadAllowlist(path).size, 0)
  await chmod(path, 0o666)
  assert.throws(() => loadAllowlist(path), /insecure-allowlist/)
})

test('a short token refuses to start', () => {
  assert.throws(() => createExecutorServer({ config: { token: 'short' }, allowlist: new Map(), engine: {} }), /at least 32/)
})

test('every container route needs the token; only allowlisted operations run, one per request', async (t) => {
  await withExecutor(t, async (base, { calls, logs }) => {
    assert.equal((await fetch(`${base}/health`)).status, 200)
    assert.equal((await fetch(`${base}/v1/containers/plex`)).status, 401)
    assert.equal((await fetch(`${base}/v1/containers/plex`, { headers: { authorization: 'Bearer wrong' } })).status, 401)
    assert.deepEqual(await (await fetch(`${base}/v1/containers/plex`, { headers: auth })).json(), { ok: true, name: 'plex', state: 'running' })
    assert.equal((await fetch(`${base}/v1/containers/other`, { headers: auth })).status, 403)
    assert.equal((await fetch(`${base}/v1/containers/plex/start`, { method: 'POST', headers: auth })).status, 403)
    assert.equal((await fetch(`${base}/v1/containers/plex/exec`, { method: 'POST', headers: auth })).status, 404)
    assert.equal((await fetch(`${base}/v1/containers/plex/restart`, { headers: auth })).status, 405)
    assert.equal((await fetch(`${base}/v1/containers/plex/restart?force=1`, { method: 'POST', headers: auth })).status, 404)
    const ran = await fetch(`${base}/v1/containers/plex/restart`, { method: 'POST', headers: auth })
    assert.deepEqual(await ran.json(), { ok: true, name: 'plex', operation: 'restart' })
    assert.deepEqual(calls.filter(([kind]) => kind === 'act'), [['act', 'plex', 'restart']])
    assert.deepEqual(logs.map((line) => line.event), ['refused', 'requested', 'succeeded'])
    assert.equal(JSON.stringify(logs).includes(token), false)
  })
})

test('Docker failures are reported without detail', async (t) => {
  const engine = { state: async () => { throw Error('boom /var/run/docker.sock') }, act: async () => { throw Error('docker-refused') } }
  await withExecutor(t, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/v1/containers/plex`, { headers: auth })).json(), { ok: false, error: 'docker-unavailable' })
    const failed = await fetch(`${base}/v1/containers/plex/stop`, { method: 'POST', headers: auth })
    assert.equal(failed.status, 502)
    assert.deepEqual(await failed.json(), { ok: false, error: 'docker-refused' })
  }, { engine })
})

test('the Docker engine client calls only inspect and start/stop/restart with a stop timeout', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'friday-executor-sock-'))
  const socketPath = join(dir, 'docker.sock')
  const seen = []
  const docker = http.createServer((request, response) => {
    seen.push([request.method, request.url])
    if (request.method === 'GET') { response.writeHead(200); return response.end(JSON.stringify({ State: { Status: 'exited' } })) }
    response.writeHead(request.url.includes('/missing/') ? 404 : 204); response.end()
  })
  docker.listen(socketPath)
  await once(docker, 'listening')
  t.after(() => docker.close())
  const engine = createDockerEngine(socketPath)
  assert.equal(await engine.state('plex'), 'exited')
  await engine.act('plex', 'stop')
  await engine.act('plex', 'start')
  await assert.rejects(engine.act('missing', 'restart'), /container-missing/)
  await assert.rejects(engine.act('plex', 'kill'), /operation-not-allowed/)
  assert.deepEqual(seen, [['GET', '/containers/plex/json'], ['POST', '/containers/plex/stop?t=30'], ['POST', '/containers/plex/start'], ['POST', '/containers/missing/restart?t=30']])
})
