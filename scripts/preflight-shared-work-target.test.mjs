import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectSupabaseGateway, normalizeSupabaseUrl } from './preflight-shared-work-target.mjs'

test('target preflight uses unauthenticated safe GET only and classifies 401 correctly', async () => {
  const calls = []
  const report = await inspectSupabaseGateway({
    baseUrl: 'http://10.1.20.10:8000',
    fetchImpl: async (url, options) => {
      calls.push({url,options})
      return new Response('{"message":"No API key found in request"}', {status:401})
    },
  })
  assert.equal(report.reachable, true)
  assert.equal(report.dataApiStatus, 401)
  assert.equal(report.authenticated, false)
  assert.equal(report.migrationReady, false)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/rest/v1/'))
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.headers.Authorization, undefined)
  assert.equal(calls[0].options.headers.apikey, undefined)
})
test('rejects URLs with embedded secrets, credentials, query, or fragments', () => {
  for (const url of [
    'http://user:pass@host:8000', 'https://host/api?apikey=private',
    'http://host/#secret', 'file:///etc/shadow', 'http://host:8000/rest/v1/',
  ]) assert.throws(() => normalizeSupabaseUrl(url), e => e.kind === 'invalid-target')
})
test('fetch failures reveal no transport or URL secrets', async () => {
  const result = await inspectSupabaseGateway({
    baseUrl: 'http://10.1.20.10:8000',
    fetchImpl: async () => {throw Error('server private transport info')}
  })
  assert.deepEqual(result, {reachable:false, dataApiStatus:null, authenticated:false, migrationReady:false})
  assert.equal(JSON.stringify(result).includes('private'),false)
})