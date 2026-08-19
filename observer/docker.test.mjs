import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeContainer } from './docker.mjs'

test('sanitizes Docker container fields and allow-lists labels', () => {
  const observedAt = '2026-08-19T12:00:00.000Z'
  const value = sanitizeContainer({
    Id: 'abcdef1234567890',
    Names: ['/nginx-proxy-manager'],
    Image: 'jc21/nginx-proxy-manager:latest',
    State: 'running',
    Status: 'Up 2 hours',
    Ports: [{ PrivatePort: 80, PublicPort: 8080, Type: 'tcp', IP: '0.0.0.0' }],
    Labels: {
      'com.docker.compose.project': 'npm',
      'com.docker.compose.service': 'app',
      secret: 'must-not-leak',
    },
  }, {
    hostName: 'VM 100',
    allowedLabelKeys: ['com.docker.compose.project', 'com.docker.compose.service'],
    observedAt,
  })

  assert.deepEqual(value, {
    id: 'abcdef123456',
    name: 'nginx-proxy-manager',
    image: 'jc21/nginx-proxy-manager:latest',
    state: 'running',
    status: 'Up 2 hours',
    ports: [{ privatePort: 80, publicPort: 8080, type: 'tcp', ip: '0.0.0.0' }],
    labels: {
      'com.docker.compose.project': 'npm',
      'com.docker.compose.service': 'app',
    },
    host: 'VM 100',
    observedAt,
  })
})
