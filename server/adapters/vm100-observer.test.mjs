import test from 'node:test'
import assert from 'node:assert/strict'
import { getVm100ObserverServices } from './vm100-observer.mjs'

test('maps sanitized VM100 observer containers into Friday services', async () => {
  const services = await getVm100ObserverServices({
    enabled: true,
    baseUrl: 'http://192.168.1.74:3199',
    token: 'secret',
    hostName: 'VM 100',
  }, async () => ({
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

test('observer adapter is inert when disabled', async () => {
  assert.deepEqual(await getVm100ObserverServices({ enabled: false }), [])
})

test('observer adapter rejects malformed inventory', async () => {
  await assert.rejects(
    getVm100ObserverServices({
      enabled: true,
      baseUrl: 'http://192.168.1.74:3199',
      token: 'secret',
      hostName: 'VM 100',
    }, async () => ({ containers: 'not-an-array' })),
    /invalid container inventory/i,
  )
})
