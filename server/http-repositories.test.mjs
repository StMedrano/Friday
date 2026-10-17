import assert from 'node:assert/strict'
import test from 'node:test'
import { createFridayServer } from './http.mjs'

async function withServer(options, run) {
  const server = createFridayServer({ config: { mode: 'mock', ai: { enabled: false } }, ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise((resolve) => server.close(resolve)) }
}

test('repository API returns safe metadata and never exposes local roots or registry policy', async () => {
  await withServer({ repositoryRegistry: { async list() {
    return [{
      id: 'friday', name: 'Friday', path: '/srv/private/friday', remote: 'https://token@github.com/owner/friday.git?secret=token',
      defaultBranch: 'main', mode: 'read-only', enabled: true, exclude: ['.env'],
    }]
  } } }, async (base) => {
    const response = await fetch(`${base}/api/repositories`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body, [{
      id: 'friday', name: 'Friday', remote: 'https://github.com/owner/friday.git',
      defaultBranch: 'main', mode: 'read-only', enabled: true,
    }])
    assert.equal(JSON.stringify(body).includes('/srv/private'), false)
    assert.equal(JSON.stringify(body).includes('token'), false)
    assert.equal(JSON.stringify(body).includes('.env'), false)
  })
})

test('repository API hides registry failures and exposes no mutation methods', async () => {
  await withServer({ repositoryRegistry: { async list() { throw new Error('private path and token') } } }, async (base) => {
    const unavailable = await fetch(`${base}/api/repositories`)
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { error: 'repository-registry-unavailable' })

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}/api/repositories`, {
        method, headers: { 'content-type': 'application/json' }, body: '{}',
      })
      assert.equal(response.status, 404, `${method} /api/repositories must not exist`)
    }
  })
})

test('repository explorer endpoints expose bounded status, paths, and file contents only', async () => {
  const calls = []
  await withServer({ repositoryRegistry: {
    async list() { return [{ id: 'friday', name: 'Friday', mode: 'read-only', enabled: true }] },
    async status(id) { calls.push(['status', id]); return { branch: 'main', dirty: false } },
    async listFiles(id, options) { calls.push(['list', id, options]); return ['README.md'] },
    async readFile(id, path) { calls.push(['read', id, path]); return 'safe text' },
  } }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/api/repositories/friday/status`)).json(), { branch: 'main', dirty: false })
    assert.deepEqual(await (await fetch(`${base}/api/repositories/friday/files?path=docs&limit=25`)).json(), ['README.md'])
    assert.deepEqual(await (await fetch(`${base}/api/repositories/friday/file?path=README.md`)).json(), { path: 'README.md', content: 'safe text' })
    assert.equal((await fetch(`${base}/api/repositories/friday/file?path=README.md`, { method: 'POST' })).status, 404)
    assert.deepEqual(calls, [
      ['status', 'friday'], ['list', 'friday', { path: 'docs', limit: 25 }], ['read', 'friday', 'README.md'],
    ])
  })
})

test('repository file limits require decimal digits before numeric conversion', async () => {
  const limits = []
  await withServer({ repositoryRegistry: {
    async listFiles(id, { limit }) { limits.push(limit); return [] },
  } }, async (base) => {
    for (const limit of ['0x10', '0b10', '1e2', '1.0000000000000001', '1.5', '+1', ' 1 ', '', 'NaN', 'Infinity']) {
      const response = await fetch(`${base}/api/repositories/friday/files?${new URLSearchParams({ limit })}`)
      assert.equal(response.status, 400, `limit=${JSON.stringify(limit)}`)
      assert.deepEqual(await response.json(), { error: 'repository-request-rejected' })
    }
    assert.deepEqual(limits, [], 'malformed limits must not reach repository traversal')
    for (const query of ['', '?limit=1', '?limit=200']) {
      assert.equal((await fetch(`${base}/api/repositories/friday/files${query}`)).status, 200)
    }
    assert.deepEqual(limits, [100, 1, 200])
  })
})
