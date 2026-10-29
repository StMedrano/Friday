import test from 'node:test'
import assert from 'node:assert/strict'
import { getProxmoxServices } from './proxmox.mjs'
import { evaluateMonitoring } from '../monitoring/incidents.mjs'
import { createEmptyMonitoringState } from '../monitoring/state.mjs'

const config = { enabled: true, baseUrl: 'https://pve.test:8006', tokenId: 'id', tokenSecret: 'secret', site: 'Home' }
const vm = (vmid, name, status, extra = {}) => ({ type: 'qemu', vmid, name, node: 'home', status, ...extra })
const api = (vms, configs = {}, calls = []) => async (_config, path) => {
  calls.push(path)
  if (path === '/cluster/resources?type=vm') return vms
  if (path === '/cluster/resources?type=node') return []
  const match = path.match(/^\/nodes\/home\/(qemu|lxc)\/(\d+)\/config$/)
  if (match) {
    const value = configs[match[2]]
    if (value instanceof Error) throw value
    return value ?? {}
  }
  throw new Error(`unexpected ${path}`)
}
const find = (services, vmid) => services.find(service => service.id.endsWith(`-${vmid}`))

test('a stopped guest with autostart disabled is maintenance, not offline', async () => {
  const services = await getProxmoxServices(config, api([vm(110, 'umbrel', 'stopped'), vm(102, 'friday', 'running')], { 110: { onboot: 0 } }))
  assert.equal(find(services, 110).status, 'maintenance')
  assert.equal(find(services, 110).detail, 'QEMU 110 · autostart disabled')
  assert.equal(find(services, 102).status, 'online')
})

test('a stopped guest that should autostart stays offline, and a maintenance tag also counts', async () => {
  const services = await getProxmoxServices(config, api(
    [vm(110, 'umbrel', 'stopped'), vm(111, 'tagged', 'stopped'), vm(112, 'crashed', 'stopped')],
    { 110: { onboot: 1, tags: 'maintenance;community-script' }, 111: { onboot: 1, tags: 'friday-ignore' }, 112: { onboot: 1 } },
  ))
  assert.equal(find(services, 110).status, 'maintenance')
  assert.equal(find(services, 111).status, 'maintenance')
  assert.equal(find(services, 112).status, 'offline')
  assert.equal(find(services, 112).detail, 'QEMU 112')
})

test('only stopped guests are inspected and config failures stay offline', async () => {
  const calls = []
  const services = await getProxmoxServices(config, api(
    [vm(100, 'running-one', 'running'), vm(110, 'umbrel', 'stopped'), vm(111, 'unreadable', 'stopped')],
    { 110: { onboot: 0 }, 111: new Error('Proxmox API 403') }, calls,
  ))
  assert.deepEqual(calls.filter(path => path.endsWith('/config')), ['/nodes/home/qemu/110/config', '/nodes/home/qemu/111/config'])
  assert.equal(find(services, 111).status, 'offline')
  assert.equal(find(services, 100).status, 'online')
})

test('maintenance services never open a monitoring incident', () => {
  const overview = { mode: 'live', services: [{ id: 'proxmox-qemu-110', name: 'umbrel', host: 'home', status: 'maintenance' }], alerts: [] }
  const first = evaluateMonitoring({ state: createEmptyMonitoringState(), overview, config: { offlineGraceSeconds: 0, historyLimit: 50 }, now: '2026-10-29T16:00:00.000Z' })
  const second = evaluateMonitoring({ state: first.state, overview, config: { offlineGraceSeconds: 0, historyLimit: 50 }, now: '2026-10-29T16:30:00.000Z' })
  assert.deepEqual(second.state.incidents.filter(incident => incident.status === 'open'), [])
})

test('stopped-guest config reads run concurrently so slow reads do not add up', async () => {
  let inFlight = 0
  let peak = 0
  const vms = [vm(110, 'a', 'stopped'), vm(111, 'b', 'stopped'), vm(112, 'c', 'stopped')]
  const services = await getProxmoxServices(config, async (_config, path) => {
    if (path === '/cluster/resources?type=vm') return vms
    if (path === '/cluster/resources?type=node') return []
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise(resolve => setTimeout(resolve, 10))
    inFlight -= 1
    return { onboot: 0 }
  })
  assert.equal(peak, 3)
  assert.deepEqual(services.filter(service => service.category === 'virtualization').map(service => service.status), ['maintenance', 'maintenance', 'maintenance'])
})
