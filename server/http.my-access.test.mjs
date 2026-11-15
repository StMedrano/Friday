import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createFridayServer} from './http.mjs'

async function withServer(gate, fn) {
  const server = createFridayServer({config: {mode: 'live', access: {enabled: true}, ai: {enabled: false}, monitoring: {enabled: false}}, accessGateImpl: gate})
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

test('my-access reports the signed-in email, operator status and provider check', async () => {
  await withServer(async () => ({status: 200, identity: {subject: 's', email: 'op@example.com', operator: true, providerVerified: true}}), async base => {
    assert.deepEqual(await (await fetch(base + '/api/settings/my-access')).json(),
      {signedIn: true, email: 'op@example.com', operator: true, providerVerified: true})
    assert.equal((await fetch(base + '/api/settings/my-access?x=1')).status, 400)
  })
  await withServer(async () => ({status: 200, identity: {subject: 's', email: 'pin@example.com', operator: false, providerVerified: false}}), async base => {
    assert.deepEqual(await (await fetch(base + '/api/settings/my-access')).json(),
      {signedIn: true, email: 'pin@example.com', operator: false, providerVerified: false})
  })
  await withServer(async () => ({status: 200, identity: {subject: 'x.access', kind: 'service'}}), async base => {
    assert.equal((await fetch(base + '/api/settings/my-access')).status, 403)
  })
  await withServer(async () => ({status: 403}), async base => {
    assert.equal((await fetch(base + '/api/settings/my-access')).status, 403)
  })
})
