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
