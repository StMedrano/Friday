import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { getVm100ObserverServices } from './vm100-observer.mjs'

async function listen(t, handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

function config(baseUrl) {
  return {
    enabled: true,
    baseUrl,
    token: 'secret',
    hostName: 'VM 100',
  }
}

test('maps sanitized VM100 observer containers into Friday services', async () => {
  const services = await getVm100ObserverServices(config('http://192.168.1.74:3199'), async () => ({
    host: 'VM 100',
    observedAt: '2026-08-19T12:00:00.000Z',
    containers: [{
      id: 'abcdef123456',
      name: 'nginx-proxy-manager',
      image: 'jc21/nginx-proxy-manager:latest',
      state: 'running',
      status: 'Up 2 hours',
      host: 'VM 100',
    }],
  }))

  assert.deepEqual(services, [{
    id: 'vm100-observer-abcdef123456',
    name: 'nginx-proxy-manager',
    category: 'container',
    host: 'VM 100',
    site: 'Site A',
    status: 'online',
    detail: 'jc21/nginx-proxy-manager:latest',
    updated: 'Up 2 hours',
  }])
})

test('controller host label overrides observer-supplied host values', async () => {
  const services = await getVm100ObserverServices(config('http://192.168.1.74:3199'), async () => ({
    host: 'spoofed-payload-host',
    containers: [{
      id: 'abcdef123456',
      name: 'example',
      image: 'example:latest',
      state: 'running',
      host: 'spoofed-container-host',
    }],
  }))

  assert.equal(services[0].host, 'VM 100')
})

test('maps non-running Docker states conservatively', async () => {
  const services = await getVm100ObserverServices(config('http://192.168.1.74:3199'), async () => ({
    containers: [
      { id: 'paused', name: 'paused', image: 'x', state: 'paused' },
      { id: 'restarting', name: 'restarting', image: 'x', state: 'restarting' },
      { id: 'exited', name: 'exited', image: 'x', state: 'exited' },
    ],
  }))

  assert.deepEqual(services.map((service) => service.status), ['degraded', 'degraded', 'offline'])
})

test('observer adapter is inert when disabled', async () => {
  assert.deepEqual(await getVm100ObserverServices({ enabled: false }), [])
})

test('observer adapter reports HTTP authentication failures', async (t) => {
  const baseUrl = await listen(t, (_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"error":"unauthorized"}')
  })

  await assert.rejects(getVm100ObserverServices(config(baseUrl)), /VM100 observer HTTP 401/)
})

test('observer adapter rejects malformed JSON', async (t) => {
  const baseUrl = await listen(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{not-json')
  })

  await assert.rejects(getVm100ObserverServices(config(baseUrl)), /JSON|Unexpected|property name/i)
})

test('observer adapter times out safely', { timeout: 7000 }, async (t) => {
  const baseUrl = await listen(t, () => {})
  await assert.rejects(getVm100ObserverServices(config(baseUrl)), /VM100 observer timeout/)
})

test('observer adapter rejects malformed inventory', async () => {
  await assert.rejects(
    getVm100ObserverServices(config('http://192.168.1.74:3199'), async () => ({ containers: 'not-an-array' })),
    /invalid container inventory/i,
  )
})
