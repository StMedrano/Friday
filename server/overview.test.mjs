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

test('live overview exposes only observed services and never sample site or resource telemetry', async () => {
  const observed = {
    id: 'proxmox-qemu-102', name: 'friday-controller', category: 'virtualization',
    host: 'home', site: 'Site A', status: 'online', detail: 'QEMU 102', updated: 'now',
  }
  const result = await buildOverview(liveConfig(), {
    getDockerServices: async () => [],
    getProxmoxServices: async () => [observed],
    getVm100ObserverServices: async () => [],
    getEndpointServices: async () => [],
  })

  assert.equal(result.mode, 'live')
  assert.deepEqual(result.services, [observed])
  assert.deepEqual(result.sites, [])
  assert.deepEqual(result.resources, [])
  assert.deepEqual(result.activities, [])
})

test('live adapter outage leaves inventory empty instead of claiming sample services are online', async () => {
  const result = await buildOverview(liveConfig(), {
    getDockerServices: async () => [],
    getProxmoxServices: async () => { throw new Error('Proxmox unavailable') },
    getVm100ObserverServices: async () => { throw new Error('observer unavailable') },
    getEndpointServices: async () => [],
  })

  assert.equal(result.mode, 'live')
  assert.deepEqual(result.services, [])
  assert.deepEqual(result.sites, [])
  assert.deepEqual(result.resources, [])
  assert.deepEqual(result.activities, [])
  assert.equal(result.alerts.length, 2)
  assert.ok(result.alerts.every((alert) => alert.title === 'Integration degraded'))
})

test('mock mode preserves demo data without calling live adapters or requiring credentials', async () => {
  const unexpected = async () => { throw new Error('Mock mode must not call live adapters') }
  const result = await buildOverview({ mode: 'mock' }, {
    getDockerServices: unexpected, getProxmoxServices: unexpected,
    getVm100ObserverServices: unexpected, getEndpointServices: unexpected,
  })

  assert.equal(result.mode, 'mock')
  assert.ok(result.services.length > 0)
  assert.ok(result.sites.length > 0)
  assert.ok(result.resources.length > 0)
  assert.ok(result.alerts.some((alert) => alert.id === 'mock-alert'))
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
