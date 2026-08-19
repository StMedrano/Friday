import test from 'node:test'
import assert from 'node:assert/strict'
import { getObserverConfig } from './config.mjs'

test('observer config is explicit and server-side', () => {
  const config = getObserverConfig({
    FRIDAY_OBSERVER_PORT: '3199',
    FRIDAY_OBSERVER_BIND_ADDRESS: '192.168.1.74',
    FRIDAY_OBSERVER_TOKEN: 'observer-secret',
    FRIDAY_OBSERVER_HOST_NAME: 'VM 100',
    FRIDAY_OBSERVER_ALLOWED_LABEL_KEYS: 'com.docker.compose.project,com.docker.compose.service',
  })

  assert.equal(config.port, 3199)
  assert.equal(config.bindAddress, '192.168.1.74')
  assert.equal(config.token, 'observer-secret')
  assert.equal(config.hostName, 'VM 100')
  assert.equal(config.dockerSocketPath, '/var/run/docker.sock')
  assert.deepEqual(config.allowedLabelKeys, ['com.docker.compose.project', 'com.docker.compose.service'])
})

test('observer defaults never invent a token', () => {
  const config = getObserverConfig({})
  assert.equal(config.port, 3199)
  assert.equal(config.token, '')
})
