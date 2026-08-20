import test from 'node:test'
import assert from 'node:assert/strict'
import {
  containerIdFromServiceId,
  getVm100ContainerDiagnostic,
  getVm100ContainerLogs,
} from './vm100-observer-diagnostics.mjs'

const config = {
  enabled: true,
  baseUrl: 'http://192.168.1.124:3199',
  token: 'observer-secret',
  hostName: 'VM 100',
}

test('container id is derived only from VM100 observer service ids', () => {
  assert.equal(containerIdFromServiceId('vm100-observer-abcdef123456'), 'abcdef123456')
  assert.equal(containerIdFromServiceId('vm100-observer-ABCDEF1234567890'), 'ABCDEF1234567890')
  assert.equal(containerIdFromServiceId('docker-abcdef123456'), null)
  assert.equal(containerIdFromServiceId('vm100-observer-../bad'), null)
  assert.equal(containerIdFromServiceId('vm100-observer-short'), null)
})

test('diagnostic adapter uses only the fixed authenticated inspect route', async () => {
  let seen
  const body = { id: 'abcdef123456', state: 'exited', exitCode: 255 }
  const result = await getVm100ContainerDiagnostic(config, 'abcdef123456', async (request) => {
    seen = request
    return body
  })
  assert.deepEqual(seen, {
    baseUrl: 'http://192.168.1.124:3199',
    path: '/api/v1/containers/abcdef123456/inspect',
    authorization: 'Bearer observer-secret',
  })
  assert.deepEqual(result, body)
})

test('log adapter uses only the fixed authenticated logs route with bounded tail', async () => {
  let seen
  const body = { id: 'abcdef123456', logs: 'safe', tail: 100, truncated: false }
  const result = await getVm100ContainerLogs(config, 'abcdef123456', 100, async (request) => {
    seen = request
    return body
  })
  assert.deepEqual(seen, {
    baseUrl: 'http://192.168.1.124:3199',
    path: '/api/v1/containers/abcdef123456/logs?tail=100',
    authorization: 'Bearer observer-secret',
  })
  assert.deepEqual(result, body)
})

test('diagnostic adapter rejects invalid ids and disabled configuration before provider access', async () => {
  let calls = 0
  const requestImpl = async () => { calls += 1; return {} }
  await assert.rejects(() => getVm100ContainerDiagnostic(config, '../bad', requestImpl), /invalid container id/i)
  await assert.rejects(() => getVm100ContainerLogs({ ...config, enabled: false }, 'abcdef123456', 100, requestImpl), /observer diagnostics unavailable/i)
  assert.equal(calls, 0)
})

test('log adapter defaults invalid tail requests to 100 and never exceeds 200', async () => {
  const paths = []
  const requestImpl = async (request) => { paths.push(request.path); return { logs: '', tail: 100, truncated: false } }
  await getVm100ContainerLogs(config, 'abcdef123456', undefined, requestImpl)
  await getVm100ContainerLogs(config, 'abcdef123456', 9999, requestImpl)
  assert.deepEqual(paths, [
    '/api/v1/containers/abcdef123456/logs?tail=100',
    '/api/v1/containers/abcdef123456/logs?tail=200',
  ])
})
