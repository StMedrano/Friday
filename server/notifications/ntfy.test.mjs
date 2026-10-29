import test from 'node:test'
import assert from 'node:assert/strict'
import {getConfig} from '../config.mjs'
import {createMonitoringRuntime} from '../monitoring/runtime.mjs'
import {createNtfyNotifier, incidentChanges, ntfyTopicUrl} from './ntfy.mjs'

const incident = (id, status, extra = {}) => ({id, status, title: 'Service offline', detail: 'wga-development is offline on VM 100', severity: 'high', host: 'VM 100', serviceName: 'wga-development', ...extra})

test('accepts only https topic URLs without credentials, query or nested paths', () => {
  assert.equal(ntfyTopicUrl('https://ntfy.sh/friday-alerts_123'), 'https://ntfy.sh/friday-alerts_123')
  for (const bad of ['http://ntfy.sh/topic', 'https://user:pw@ntfy.sh/topic', 'https://ntfy.sh/topic?x=1', 'https://ntfy.sh/a/b', 'https://ntfy.sh/', 'nonsense', ''])
    assert.equal(ntfyTopicUrl(bad), '', bad)
  assert.equal(createNtfyNotifier({url: 'http://ntfy.sh/topic'}), null)
})

test('posts opened and resolved incidents with ASCII titles, priority and optional token', async () => {
  const calls = []
  const notifier = createNtfyNotifier({url: 'https://ntfy.example.test/friday', token: 'tk_secret', fetchImpl: async (url, options) => { calls.push([url, options]); return new Response('{}', {status: 200}) }})
  const result = await notifier.notify({opened: [incident('a', 'open', {title: 'Service offline — ünïcode'})], resolved: [incident('b', 'resolved')]})
  assert.deepEqual(result, {sent: 2, failed: 0})
  assert.equal(calls[0][0], 'https://ntfy.example.test/friday')
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.priority, '4')
  assert.equal(calls[0][1].headers.authorization, 'Bearer tk_secret')
  assert.match(calls[0][1].headers.title, /^[\x20-\x7e]+$/)
  assert.match(calls[0][1].body, /wga-development is offline on VM 100/)
  assert.match(calls[1][1].headers.title, /^Friday resolved: wga-development$/)
  assert.equal(calls[1][1].headers.priority, '2')
})

test('caps a burst at five messages with a summary and survives delivery failures', async () => {
  let calls = 0
  const notifier = createNtfyNotifier({url: 'https://ntfy.example.test/friday', fetchImpl: async () => { calls += 1; return new Response('', {status: calls === 2 ? 500 : 200}) }})
  const opened = Array.from({length: 9}, (_, i) => incident(`i${i}`, 'open'))
  const result = await notifier.notify({opened})
  assert.equal(calls, 5)
  assert.deepEqual(result, {sent: 4, failed: 1})
})

test('detects only newly opened and newly resolved incidents', () => {
  const before = [incident('a', 'open'), incident('b', 'open'), incident('c', 'resolved')]
  const after = [incident('a', 'open'), incident('b', 'resolved'), incident('c', 'resolved'), incident('d', 'open')]
  const changes = incidentChanges(before, after)
  assert.deepEqual(changes.opened.map(item => item.id), ['d'])
  assert.deepEqual(changes.resolved.map(item => item.id), ['b'])
})

test('config reads the ntfy topic server-side', () => {
  assert.deepEqual(getConfig({}).notifications.ntfy, {url: '', token: ''})
  assert.deepEqual(getConfig({FRIDAY_NTFY_URL: 'https://ntfy.sh/x', FRIDAY_NTFY_TOKEN: 't'}).notifications.ntfy, {url: 'https://ntfy.sh/x', token: 't'})
})

test('monitoring runtime notifies when a poll opens an incident and never fails the poll on notifier errors', async () => {
  const seen = []
  let status = 'online'
  const memory = {state: null}
  const runtime = createMonitoringRuntime({
    config: {monitoring: {enabled: true, pollSeconds: 30, offlineGraceSeconds: 0, historyLimit: 100}},
    collectOverview: async () => ({mode: 'live', services: [{id: 's1', name: 'web', host: 'VM 100', status}], alerts: []}),
    store: {load: async () => memory.state, save: async state => { memory.state = structuredClone(state) }},
    notifyIncidents: async changes => { seen.push(changes); throw new Error('ntfy down') },
    setIntervalImpl: () => 0, clearIntervalImpl: () => {},
  })
  await runtime.poll()
  status = 'offline'
  await runtime.poll()
  await new Promise(resolve => setImmediate(resolve))
  const opened = seen.flatMap(changes => changes.opened)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].serviceId, 's1')
  assert.equal(runtime.getSummary().status, 'ok')
})
