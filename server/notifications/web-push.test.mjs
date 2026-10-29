import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {getConfig} from '../config.mjs'
import {createFridayServer} from '../http.mjs'
import {createPushSubscriptionStore, createWebPushNotifier, normalizeSubscription, vapidKeys} from './web-push.mjs'

const keys = {publicKey: 'BPublicKeyValue_0123456789abcdefghijklmnopqrstuvwxyz', privateKey: 'PrivateKeyValue_0123456789abcdef', subject: 'mailto:ops@example.test'}
const subscription = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc123') => ({endpoint, keys: {p256dh: 'BKp256dhValue_0123456789abcdefghij', auth: 'AuthValue_01234567'}})
const incident = (id, status) => ({id, status, title: 'Service offline', detail: 'umbrel is offline on home', severity: 'high', host: 'home', serviceName: 'umbrel'})

async function tempStore(t) {
  const root = await mkdtemp(join(tmpdir(), 'friday-push-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const path = join(root, 'push-subscriptions.json')
  return {path, store: await createPushSubscriptionStore({path})}
}

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

const json = {'content-type': 'application/json'}
const verifiedGate = async () => ({status: 200, identity: {subject: 'user-sub', email: 'owner@example.test'}})

test('accepts only https subscriptions with base64url keys', () => {
  assert.equal(normalizeSubscription(subscription()).endpoint, 'https://fcm.googleapis.com/fcm/send/abc123')
  for (const bad of [null, {}, subscription('http://push.test/x'), subscription('https://u:p@push.test/x'), {...subscription(), keys: {p256dh: 'short', auth: 'AuthValue_01234567'}}, {...subscription(), keys: {p256dh: 'BKp256dhValue_0123456789abcdefghij', auth: 'has spaces!!'}}])
    assert.equal(normalizeSubscription(bad), null, JSON.stringify(bad))
  assert.equal(vapidKeys({...keys, subject: 'not-a-subject'}), null)
  assert.deepEqual(vapidKeys(keys), keys)
  assert.equal(createWebPushNotifier({keys: {...keys, privateKey: ''}, store: {}}), null)
})

test('store persists subscriptions atomically, dedupes by endpoint and reloads', async t => {
  const {path, store} = await tempStore(t)
  const added = await store.add(subscription())
  await store.add(subscription())
  await store.add(subscription('https://push.example.test/other'))
  assert.equal(store.list().length, 2)
  assert.ok(store.has(added.id))
  assert.equal((await createPushSubscriptionStore({path})).list().length, 2)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 2)
  await store.remove(added.id)
  assert.equal(store.list().length, 1)
  await assert.rejects(store.add({endpoint: 'http://push.test/x'}), {code: 'invalid-subscription'})
})

test('notifier pushes opened and resolved incidents and drops gone subscriptions', async t => {
  const {store} = await tempStore(t)
  const live = await store.add(subscription())
  await store.add(subscription('https://push.example.test/expired'))
  const sent = []
  const notifier = createWebPushNotifier({keys, store, sendImpl: async (target, payload) => {
    if (target.endpoint.endsWith('/expired')) throw Object.assign(new Error('gone'), {statusCode: 410})
    sent.push(JSON.parse(payload))
  }})
  assert.equal(notifier.publicKey, keys.publicKey)
  const result = await notifier.notify({opened: [incident('a', 'open')], resolved: [incident('b', 'resolved')]})
  // The expired endpoint is dropped after its first failure, so the resolved push only reaches the live device.
  assert.deepEqual(result, {sent: 2, failed: 1})
  assert.deepEqual(sent.map(event => event.kind), ['opened', 'resolved'])
  assert.equal(sent[0].severity, 'high')
  assert.match(sent[0].body, /umbrel is offline on home/)
  assert.deepEqual(store.list().map(item => item.id), [live.id])
})

test('a burst is capped at five payloads with a summary', async t => {
  const {store} = await tempStore(t)
  await store.add(subscription())
  const sent = []
  const notifier = createWebPushNotifier({keys, store, sendImpl: async (_target, payload) => { sent.push(JSON.parse(payload)) }})
  await notifier.notify({opened: Array.from({length: 8}, (_, index) => incident(`i${index}`, 'open'))})
  assert.equal(sent.length, 5)
  assert.equal(sent.at(-1).kind, 'summary')
  assert.match(sent.at(-1).title, /4 more incident changes/)
})

test('config reads VAPID keys server-side and settings reports browser push', () => {
  assert.deepEqual(getConfig({}).notifications.webPush, {publicKey: '', privateKey: '', subject: ''})
  const configured = getConfig({FRIDAY_VAPID_PUBLIC_KEY: keys.publicKey, FRIDAY_VAPID_PRIVATE_KEY: keys.privateKey, FRIDAY_VAPID_SUBJECT: keys.subject})
  assert.deepEqual(configured.notifications.webPush, keys)
})

test('subscription API serves the public key, stores a device and never leaks the private key', async t => {
  const {store} = await tempStore(t)
  const config = {...getConfig({FRIDAY_MODE: 'live'})}
  config.notifications = {...config.notifications, webPush: keys}
  await withServer({config, accessGateImpl: verifiedGate, pushSubscriptions: store}, async base => {
    const view = await (await fetch(base + '/api/notifications/web-push')).json()
    assert.deepEqual(view, {enabled: true, publicKey: keys.publicKey})
    assert.equal(JSON.stringify(view).includes(keys.privateKey), false)

    assert.equal((await fetch(base + '/api/notifications/web-push', {method: 'POST', headers: {'content-type': 'text/plain'}, body: '{}'})).status, 415)
    assert.equal((await fetch(base + '/api/notifications/web-push', {method: 'POST', headers: {...json, 'sec-fetch-site': 'cross-site'}, body: JSON.stringify(subscription())})).status, 403)
    assert.equal((await fetch(base + '/api/notifications/web-push', {method: 'POST', headers: json, body: '{"endpoint":"http://push.test/x"}'})).status, 400)

    const saved = await fetch(base + '/api/notifications/web-push', {method: 'POST', headers: json, body: JSON.stringify(subscription())})
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), {subscribed: true})
    assert.equal(store.list().length, 1)

    const removed = await fetch(base + '/api/notifications/web-push', {method: 'DELETE', headers: json, body: JSON.stringify(subscription())})
    assert.equal(removed.status, 200)
    assert.equal(store.list().length, 0)
  })
})

test('subscription API reports disabled without VAPID keys and refuses writes', async t => {
  const {store} = await tempStore(t)
  await withServer({config: getConfig({FRIDAY_MODE: 'live'}), accessGateImpl: verifiedGate, pushSubscriptions: store}, async base => {
    assert.deepEqual(await (await fetch(base + '/api/notifications/web-push')).json(), {enabled: false, publicKey: null})
    assert.equal((await fetch(base + '/api/notifications/web-push', {method: 'POST', headers: json, body: JSON.stringify(subscription())})).status, 503)
  })
})
