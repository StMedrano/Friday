import test from 'node:test'
import assert from 'node:assert/strict'
import { getProxmoxServices } from './proxmox.mjs'

const config = { enabled: true, baseUrl: 'https://pve.test:8006', tokenId: 'id', tokenSecret: 'secret', site: 'Home' }
const GiB = 2 ** 30
const api = ({ memory, swap, statusError = false }) => async (_config, path) => {
  if (path === '/cluster/resources?type=vm') return [{ type: 'qemu', vmid: 102, name: 'friday-controller', node: 'home', status: 'running' }]
  if (path === '/cluster/resources?type=node') return [{ type: 'node', node: 'home', status: 'online', mem: 20 * GiB, maxmem: 30 * GiB }]
  if (path === '/nodes/home/status') {
    if (statusError) throw new Error('Proxmox API 403')
    return { memory, swap }
  }
  throw new Error(`unexpected ${path}`)
}
const host = services => services.find(service => service.id === 'proxmox-node-home')

test('reports Proxmox host memory and swap as an online host service', async () => {
  const services = await getProxmoxServices(config, api({
    memory: { total: 30 * GiB, used: 21 * GiB, available: 11 * GiB }, swap: { total: 8 * GiB, used: 4 * GiB },
  }))
  assert.equal(services.length, 2)
  assert.deepEqual(host(services), {
    id: 'proxmox-node-home', name: 'Proxmox host home', category: 'host', host: 'home', site: 'Home',
    status: 'online', detail: 'Memory 63% used · swap 50% used', updated: 'live',
  })
})

test('marks the host degraded when memory or swap pressure is high so monitoring opens an incident', async () => {
  const memoryHigh = await getProxmoxServices(config, api({ memory: { total: 30 * GiB, available: 3 * GiB }, swap: { total: 8 * GiB, used: 1 * GiB } }))
  assert.equal(host(memoryHigh).status, 'degraded')
  assert.match(host(memoryHigh).detail, /Memory 90% used/)
  const swapHigh = await getProxmoxServices(config, api({ memory: { total: 30 * GiB, available: 10 * GiB }, swap: { total: 8 * GiB, used: 7 * GiB } }))
  assert.equal(host(swapHigh).status, 'degraded')
  assert.match(host(swapHigh).detail, /swap 88% used/)
})

test('falls back to cluster memory figures and never fails VM inventory when host status is unreadable', async () => {
  const services = await getProxmoxServices(config, api({ statusError: true }))
  assert.equal(services.find(service => service.id === 'proxmox-qemu-102').status, 'online')
  assert.equal(host(services).status, 'online')
  assert.equal(host(services).detail, 'Memory 67% used · swap unknown')
})

test('reports an offline node as offline', async () => {
  const services = await getProxmoxServices(config, async (_c, path) => path === '/cluster/resources?type=node'
    ? [{ type: 'node', node: 'home', status: 'offline' }]
    : path === '/cluster/resources?type=vm' ? [] : (() => { throw new Error('down') })())
  assert.equal(host(services).status, 'offline')
  assert.equal(host(services).detail, 'Node offline')
})
