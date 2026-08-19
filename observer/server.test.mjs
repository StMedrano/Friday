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
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('observer exposes only health and authenticated container inventory routes', async (t) => {
  const config = {
    port: 0,
    bindAddress: '127.0.0.1',
    token: 'correct',
    hostName: 'VM 100',
    dockerSocketPath: '/var/run/docker.sock',
    allowedLabelKeys: [],
  }
  const server = createObserverServer({
    config,
    getContainers: async () => [{ id: 'abc123', name: 'example' }],
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port

  assert.equal((await request(port, '/health')).status, 200)
  assert.equal((await request(port, '/api/v1/containers')).status, 401)
  assert.equal((await request(port, '/api/v1/containers', 'Bearer wrong')).status, 401)
  assert.equal((await request(port, '/api/v1/containers', 'Bearer correct')).status, 200)
  assert.equal((await request(port, '/api/v1/containers', 'Bearer correct', 'POST')).status, 404)
  assert.equal((await request(port, '/api/v1/restart', 'Bearer correct', 'POST')).status, 404)
})
