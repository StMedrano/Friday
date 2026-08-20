import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createObserverServer } from './server.mjs'

function request(port, path, authorization, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: authorization ? { Authorization: authorization } : {},
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body, json: () => JSON.parse(body) }))
    })
    req.on('error', reject)
    req.end()
  })
}

function baseConfig() {
  return {
    port: 0,
    bindAddress: '127.0.0.1',
    token: 'correct',
    hostName: 'VM 100',
    dockerSocketPath: '/var/run/docker.sock',
    allowedLabelKeys: [],
  }
}

async function withObserver(options, fn) {
  const server = createObserverServer({ config: baseConfig(), ...options })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(port)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('observer preserves health and authenticated container inventory routes', async () => {
  await withObserver({
    getContainers: async () => [{ id: 'abc123', name: 'example' }],
  }, async (port) => {
    assert.equal((await request(port, '/health')).status, 200)
    assert.equal((await request(port, '/api/v1/containers')).status, 401)
    assert.equal((await request(port, '/api/v1/containers', 'Bearer wrong')).status, 401)
    assert.equal((await request(port, '/api/v1/containers', 'Bearer correct')).status, 200)
    assert.equal((await request(port, '/api/v1/containers', 'Bearer correct', 'POST')).status, 404)
    assert.equal((await request(port, '/api/v1/restart', 'Bearer correct', 'POST')).status, 404)
  })
})

test('observer exposes authenticated GET-only inspect and logs routes', async () => {
  const seen = []
  await withObserver({
    getContainers: async () => [{ id: 'abcdef123456', name: 'example' }],
    getInspect: async (_config, id) => {
      seen.push(['inspect', id])
      return { id, name: 'example', state: 'exited', exitCode: 255 }
    },
    getLogs: async (_config, id, tail) => {
      seen.push(['logs', id, tail])
      return { id, logs: 'safe log', tail, truncated: false, observedAt: '2026-08-20T00:00:00.000Z' }
    },
  }, async (port) => {
    assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect')).status, 401)
    const inspect = await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct')
    assert.equal(inspect.status, 200)
    assert.equal(inspect.json().exitCode, 255)

    const logs = await request(port, '/api/v1/containers/abcdef123456/logs?tail=9999', 'Bearer correct')
    assert.equal(logs.status, 200)
    assert.equal(logs.json().tail, 200)
    assert.deepEqual(seen, [
      ['inspect', 'abcdef123456'],
      ['logs', 'abcdef123456', 200],
    ])

    assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct', 'POST')).status, 404)
    assert.equal((await request(port, '/api/v1/containers/abcdef123456/logs', 'Bearer correct', 'DELETE')).status, 404)
    assert.equal((await request(port, '/api/v1/containers/abcdef123456/not-real', 'Bearer correct')).status, 404)
  })
})

test('observer rejects invalid tokens before invoking diagnostic providers', async () => {
  let calls = 0
  await withObserver({
    getInspect: async () => { calls += 1; return {} },
    getLogs: async () => { calls += 1; return {} },
  }, async (port) => {
    assert.equal((await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer wrong')).status, 401)
    assert.equal((await request(port, '/api/v1/containers/abcdef123456/logs', 'Bearer wrong')).status, 401)
    assert.equal(calls, 0)
  })
})

test('observer maps unknown or invalid diagnostic container ids to safe 404', async () => {
  for (const message of ['Unknown container id', 'Ambiguous container id', 'Invalid container id']) {
    await withObserver({
      getInspect: async () => { throw new Error(message) },
    }, async (port) => {
      const response = await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct')
      assert.equal(response.status, 404)
      assert.deepEqual(response.json(), { error: 'container-not-found' })
    })
  }
})

test('observer returns sanitized bounded errors for diagnostic provider failures', async () => {
  await withObserver({
    getInspect: async () => { throw new Error(`Docker unavailable token=secret ${'x'.repeat(400)}`) },
  }, async (port) => {
    const response = await request(port, '/api/v1/containers/abcdef123456/inspect', 'Bearer correct')
    assert.equal(response.status, 503)
    const body = response.json()
    assert.equal(body.error, 'docker-unavailable')
    assert.equal(body.detail.includes('secret'), false)
    assert.ok(body.detail.length <= 160)
  })
})
