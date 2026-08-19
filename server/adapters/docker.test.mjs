import test from 'node:test'
import assert from 'node:assert/strict'
import { getDockerServices } from './docker.mjs'

test('local Docker inventory uses configured controller host name', async () => {
  const services = await getDockerServices({
    enabled: true,
    socketPath: '/var/run/docker.sock',
    hostName: 'VM 102',
  }, async () => [{
    Id: 'abcdef1234567890',
    Names: ['/friday'],
    Image: 'friday-friday',
    State: 'running',
    Status: 'Up 5 minutes',
  }])

  assert.equal(services[0].host, 'VM 102')
  assert.equal(services[0].name, 'friday')
})
