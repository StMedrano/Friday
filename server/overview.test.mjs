import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview } from './overview.mjs'

function liveConfig() {
  return {
    mode: 'live',
    docker: { enabled: false },
    proxmox: { enabled: false },
    vm100Observer: { enabled: true, baseUrl: 'http://192.168.1.74:3199', token: 'secret', hostName: 'VM 100' },
    endpoints: { enabled: false, urls: [] },
  }
}

test('live overview merges VM100 observer services', async () => {
  const result = await buildOverview(liveConfig(), {
    getDockerServices: async () => [],
    getProxmoxServices: async () => [],
    getVm100ObserverServices: async () => [{
      id: 'vm100-observer-abc',
      name: 'npm',
      category: 'container',
      host: 'VM 100',
      site: 'Site A',
      status: 'online',
      detail: 'image',
      updated: 'Up',
    }],
    getEndpointServices: async () => [],
  })

  assert.equal(result.services.length, 1)
  assert.equal(result.services[0].host, 'VM 100')
  assert.equal(result.integrations.find((item) => item.id === 'vm100-observer').enabled, true)
})

test('observer failure degrades overview instead of failing it', async () => {
  const result = await buildOverview(liveConfig(), {
    getDockerServices: async () => [],
    getProxmoxServices: async () => [],
    getVm100ObserverServices: async () => { throw new Error('observer offline') },
    getEndpointServices: async () => [],
  })

  assert.equal(result.mode, 'live')
  assert.ok(result.alerts.some((alert) => alert.title === 'Integration degraded' && alert.detail.includes('observer offline')))
})
