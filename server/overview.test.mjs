import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverview, decorateOverviewWithMonitoring } from './overview.mjs'

function liveConfig() {
  return {
    mode: 'live',
    docker: { enabled: false },
    proxmox: { enabled: false },
    vm100Observer: { enabled: true, baseUrl: 'http://192.168.1.124:3199', token: 'secret', hostName: 'VM 100' },
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

test('monitoring decoration preserves overview and appends incident alert without mutation', () => {
  const base = {
    mode: 'live',
    generatedAt: '2026-08-19T00:00:00.000Z',
    sites: [],
    services: [{ id: 'svc', status: 'online' }],
    alerts: [{ id: 'existing', title: 'Existing', severity: 'warning', source: 'Friday', detail: 'keep me' }],
    resources: [],
    activities: [],
    integrations: [{ id: 'vm100-observer', enabled: true, mode: 'live' }],
  }
  const incident = { id: 'i1', status: 'open', severity: 'high', title: 'Service offline', detail: 'nginx-proxy-manager', source: 'monitoring' }
  const decorated = decorateOverviewWithMonitoring(base, {
    incidents: [incident],
    summary: { enabled: true, status: 'ok', activeIncidents: 1 },
  })
  assert.equal(decorated.incidents.length, 1)
  assert.equal(decorated.monitoring.activeIncidents, 1)
  assert.ok(decorated.alerts.some((alert) => alert.id === 'incident-i1'))
  assert.ok(decorated.alerts.some((alert) => alert.id === 'existing'))
  assert.equal(base.alerts.length, 1)
  assert.equal('incidents' in base, false)
})
