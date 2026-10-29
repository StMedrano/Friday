import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from '../config.mjs'
import { getDockerServices } from './docker.mjs'
import { getEndpointServices } from './endpoints.mjs'
import { getProxmoxServices } from './proxmox.mjs'
import { getVm100ObserverServices } from './vm100-observer.mjs'

test('hardcoded-site adapters default to Site A and accept configured site labels', () => {
  const defaults = getConfig({})
  for (const key of ['docker', 'proxmox', 'vm100Observer', 'endpoints']) assert.equal(defaults[key].site, 'Site A', key)

  const configured = getConfig({
    FRIDAY_DOCKER_SITE: ' Home ',
    FRIDAY_PROXMOX_SITE: 'Home',
    FRIDAY_VM100_OBSERVER_SITE: 'Home',
    FRIDAY_ENDPOINTS_SITE: 'Remote Office',
  })
  assert.equal(configured.docker.site, 'Home')
  assert.equal(configured.proxmox.site, 'Home')
  assert.equal(configured.vm100Observer.site, 'Home')
  assert.equal(configured.endpoints.site, 'Remote Office')
  assert.equal(getConfig({ FRIDAY_PROXMOX_SITE: '   ' }).proxmox.site, 'Site A')
})

test('Proxmox services carry the configured site label', async () => {
  const config = { enabled: true, baseUrl: 'https://pve.test:8006', tokenId: 'id', tokenSecret: 'secret', site: 'Home' }
  const services = await getProxmoxServices(config, async () => [{ type: 'qemu', vmid: 100, name: 'ubuntu-docker', node: 'home', status: 'running' }])
  assert.equal(services[0].site, 'Home')
  const fallback = await getProxmoxServices({ ...config, site: undefined }, async () => [{ type: 'lxc', vmid: 108, node: 'home', status: 'stopped' }])
  assert.equal(fallback[0].site, 'Site A')
})

test('VM100 observer and Docker services carry the configured site label', async () => {
  const observer = await getVm100ObserverServices(
    { enabled: true, baseUrl: 'http://observer.test', token: 't', site: 'Home' },
    async () => ({ containers: [{ id: 'abc', name: 'web', state: 'running' }] }),
  )
  assert.equal(observer[0].site, 'Home')
  const docker = await getDockerServices(
    { enabled: true, socketPath: '/var/run/docker.sock', site: 'Home' },
    async () => [{ Id: 'abcdef1234567890', Names: ['/friday'], State: 'running', Image: 'friday', Status: 'Up' }],
  )
  assert.equal(docker[0].site, 'Home')
})

test('legacy endpoint URLs use the configured endpoints site label', async () => {
  const services = await getEndpointServices(
    { enabled: true, urls: ['https://friday.example.test/healthz'], site: 'Remote Office' },
    { fetchImpl: async () => new Response('ok', { status: 200 }), now: () => 0 },
  )
  assert.equal(services[0].site, 'Remote Office')
})
