import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyMonitoringState } from './state.mjs'
import { evaluateMonitoring, retireService } from './incidents.mjs'

const config = { offlineGraceSeconds: 300, historyLimit: 2000 }
const offline = {
  id: 'vm100-observer-npm',
  name: 'nginx-proxy-manager',
  category: 'container',
  host: 'VM 100',
  site: 'Site A',
  status: 'offline',
  detail: 'jc21/nginx-proxy-manager:latest',
  updated: 'Exited (255)',
}
const online = { ...offline, status: 'online', updated: 'Up 10 seconds' }
const degraded = { ...offline, status: 'degraded', updated: 'Restarting' }

function evaluate(state, services, now, alerts = [], overrides = {}) {
  return evaluateMonitoring({
    state,
    overview: { services, alerts, integrations: [] },
    config: { ...config, ...overrides },
    now,
  }).state
}

test('offline service opens once after grace, resolves, and can reoccur', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [offline], '2026-08-19T00:00:00.000Z')
  assert.equal(state.incidents.length, 0)

  state = evaluate(state, [offline], '2026-08-19T00:05:01.000Z')
  const first = state.incidents.find((incident) => incident.status === 'open')
  assert.ok(first)
  assert.equal(first.type, 'service-offline')
  assert.equal(first.serviceName, 'nginx-proxy-manager')
  assert.equal(first.host, 'VM 100')
  assert.equal(first.severity, 'high')
  assert.match(first.recommendedAction, /approval/i)

  state = evaluate(state, [offline], '2026-08-19T00:06:00.000Z')
  assert.equal(state.incidents.length, 1)
  assert.equal(state.incidents[0].id, first.id)

  state = evaluate(state, [online], '2026-08-19T00:07:00.000Z')
  state = evaluate(state, [online], '2026-08-19T00:07:30.000Z')
  assert.equal(state.incidents[0].status, 'resolved')
  assert.equal(state.incidents[0].resolvedAt, '2026-08-19T00:07:30.000Z')

  state = evaluate(state, [offline], '2026-08-19T00:08:00.000Z')
  state = evaluate(state, [offline], '2026-08-19T00:13:01.000Z')
  const open = state.incidents.filter((incident) => incident.status === 'open' && incident.type === 'service-offline')
  assert.equal(open.length, 1)
  assert.notEqual(open[0].id, first.id)
  assert.equal(state.incidents.length, 2)
})

test('an open offline incident resolves when the service enters maintenance', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [offline], '2026-08-19T00:00:00.000Z')
  state = evaluate(state, [offline], '2026-08-19T00:05:01.000Z')
  assert.equal(state.incidents[0].status, 'open')

  const maintenance = { ...offline, status: 'maintenance', detail: 'VM 110 · maintenance tag' }
  state = evaluate(state, [maintenance], '2026-08-19T00:06:00.000Z')
  state = evaluate(state, [maintenance], '2026-08-19T00:06:30.000Z')
  assert.equal(state.incidents[0].status, 'resolved')
  assert.equal(state.incidents.filter((incident) => incident.status === 'open').length, 0)
})

test('degraded service opens warning after grace and resolves online', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [degraded], '2026-08-19T01:00:00.000Z', [], { offlineGraceSeconds: 60 })
  state = evaluate(state, [degraded], '2026-08-19T01:01:01.000Z', [], { offlineGraceSeconds: 60 })
  const incident = state.incidents.find((item) => item.type === 'service-degraded' && item.status === 'open')
  assert.ok(incident)
  assert.equal(incident.severity, 'warning')
  state = evaluate(state, [online], '2026-08-19T01:02:00.000Z', [], { offlineGraceSeconds: 60 })
  state = evaluate(state, [online], '2026-08-19T01:02:30.000Z', [], { offlineGraceSeconds: 60 })
  assert.equal(state.incidents.find((item) => item.id === incident.id).status, 'resolved')
})

test('failed Site B endpoint check opens a stable read-only monitoring incident',()=>{
 const endpoint={
  id:'endpoint-site-b-edge',name:'Remote edge',category:'monitoring',host:'remote.example.test',site:'Site B',
  status:'offline',detail:'Timeout',updated:'2026-10-19T00:00:00.000Z',latencyMs:4000,
 }
 let state=createEmptyMonitoringState()
 state=evaluate(state,[endpoint],'2026-10-19T00:00:00.000Z',[],{offlineGraceSeconds:30})
 state=evaluate(state,[endpoint],'2026-10-19T00:00:31.000Z',[],{offlineGraceSeconds:30})
 const incident=state.incidents.find(item=>item.status==='open')
 assert.equal(incident.type,'service-offline')
 assert.equal(incident.serviceId,'endpoint-site-b-edge')
 assert.equal(incident.serviceName,'Remote edge')
 assert.equal(incident.host,'remote.example.test')
 assert.match(incident.recommendedAction,/approval/i)
})

test('legacy endpoint recovery resolves a persisted pre-upgrade incident',()=>{
 const legacyOffline={...offline,id:'endpoint-0',name:'Legacy health URL',host:'legacy.example.test',category:'monitoring'}
 let state=createEmptyMonitoringState()
 state=evaluate(state,[legacyOffline],'2026-10-19T01:00:00.000Z',[],{offlineGraceSeconds:30})
 state=evaluate(state,[legacyOffline],'2026-10-19T01:00:31.000Z',[],{offlineGraceSeconds:30})
 const incident=state.incidents.find(item=>item.status==='open')
 assert.equal(incident.serviceId,'endpoint-0')
 const recovered={...legacyOffline,status:'online',detail:'HTTP 200'}
 state=evaluate(state,[recovered],'2026-10-19T01:01:00.000Z',[],{offlineGraceSeconds:30})
 state=evaluate(state,[recovered],'2026-10-19T01:01:30.000Z',[],{offlineGraceSeconds:30})
 assert.equal(state.incidents.find(item=>item.id===incident.id).status,'resolved')
})

test('three service transitions in fifteen minutes opens one flapping warning', () => {
  let state = createEmptyMonitoringState()
  const grace = { offlineGraceSeconds: 9999 }
  for (const [service, at] of [
    [online, '02:00:00'], [online, '02:00:30'],
    [offline, '02:01:00'], [offline, '02:01:30'],
    [online, '02:02:00'], [online, '02:02:30'],
    [offline, '02:03:00'], [offline, '02:03:30'],
  ]) state = evaluate(state, [service], `2026-08-19T${at}.000Z`, [], grace)
  const flap = state.incidents.find((item) => item.type === 'service-flapping' && item.status === 'open')
  assert.ok(flap)
  assert.equal(flap.severity, 'warning')
  assert.equal(state.incidents.filter((item) => item.type === 'service-flapping').length, 1)

  state = evaluate(state, [offline], '2026-08-19T02:20:00.000Z', [], { offlineGraceSeconds: 9999 })
  assert.equal(state.incidents.find((item) => item.id === flap.id).status, 'resolved')
})

test('one swallowed poll is not a state change', () => {
  // The network path to VM132 loses a whole poll near the top of most hours and
  // answers normally on the next one. That is not an outage and must not be
  // recorded as one.
  let state = createEmptyMonitoringState()
  state = evaluate(state, [online], '2026-11-17T12:59:45.000Z', [], { offlineGraceSeconds: 0 })
  state = evaluate(state, [offline], '2026-11-17T13:00:15.000Z', [], { offlineGraceSeconds: 0 })
  const observation = state.observations['vm100-observer-npm']
  assert.equal(observation.status, 'online', 'one bad poll does not flip the service')
  assert.deepEqual(observation.transitions, [], 'and writes no transition')
  assert.equal(state.incidents.length, 0, 'so nothing opens, even with no grace period')
  assert.ok(!state.history.some(event => event.type === 'service-status-changed'))

  state = evaluate(state, [online], '2026-11-17T13:00:45.000Z', [], { offlineGraceSeconds: 0 })
  assert.equal(state.observations['vm100-observer-npm'].status, 'online')
  assert.deepEqual(state.observations['vm100-observer-npm'].transitions, [])
})

test('a real outage is still dated from its first failed poll, so nothing opens later than before', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [online], '2026-11-17T00:00:00.000Z')
  state = evaluate(state, [online], '2026-11-17T00:00:30.000Z')

  // First failure at 00:01:00; confirmed on the next poll, but dated to the first.
  state = evaluate(state, [offline], '2026-11-17T00:01:00.000Z')
  state = evaluate(state, [offline], '2026-11-17T00:01:30.000Z')
  const observation = state.observations['vm100-observer-npm']
  assert.equal(observation.status, 'offline')
  assert.equal(observation.statusChangedAt, '2026-11-17T00:01:00.000Z')
  assert.equal(state.incidents.length, 0, 'the 300s grace period has not elapsed yet')

  // 00:06:00 is 300s after the first failed poll, which is when this opened before.
  state = evaluate(state, [offline], '2026-11-17T00:06:00.000Z')
  const incident = state.incidents.find(item => item.status === 'open')
  assert.ok(incident, 'the outage opens on the same schedule as before the change')
  assert.equal(incident.type, 'service-offline')
  assert.equal(incident.firstSeen, '2026-11-17T00:01:00.000Z')
})

test('a blip once an hour never opens a flapping warning', () => {
  // Reproduces the VM132 pattern: one lost poll per hour, each 30s long. Under the
  // old rule two of these inside fifteen minutes wrote the three transitions that
  // opened a warning.
  let state = createEmptyMonitoringState()
  let at = Date.UTC(2026, 10, 17, 0, 0, 0)
  for (let poll = 0; poll < 120; poll += 1) {
    const blip = poll % 20 === 7 // exactly one lost poll, as the gateway log shows
    state = evaluate(state, [blip ? offline : online], new Date(at).toISOString(), [], { offlineGraceSeconds: 0 })
    at += 30000
  }
  assert.deepEqual(state.observations['vm100-observer-npm'].transitions, [])
  assert.equal(state.incidents.length, 0)
})

test('integration degraded alert opens immediate high incident and recovery resolves it', () => {
  let state = createEmptyMonitoringState()
  const alerts = [{
    id: 'integration-0',
    title: 'Integration degraded',
    detail: 'vm100-observer: observer offline',
    severity: 'warning',
    source: 'Friday',
  }]
  state = evaluate(state, [], '2026-08-19T03:00:00.000Z', alerts)
  const incident = state.incidents.find((item) => item.type === 'integration-unavailable' && item.status === 'open')
  assert.ok(incident)
  assert.equal(incident.severity, 'high')
  assert.equal(incident.source, 'vm100-observer')
  assert.equal(incident.detail.includes('observer offline'), true)

  state = evaluate(state, [], '2026-08-19T03:01:00.000Z', [])
  assert.equal(state.incidents.find((item) => item.id === incident.id).status, 'resolved')
  assert.ok(state.history.some((event) => event.type === 'integration-recovered' && event.source === 'vm100-observer'))
})

test('history records status changes and incident lifecycle events', () => {
  let state = createEmptyMonitoringState()
  state = evaluate(state, [offline], '2026-08-19T04:00:00.000Z', [], { offlineGraceSeconds: 1 })
  state = evaluate(state, [offline], '2026-08-19T04:00:02.000Z', [], { offlineGraceSeconds: 1 })
  state = evaluate(state, [online], '2026-08-19T04:00:03.000Z', [], { offlineGraceSeconds: 1 })
  state = evaluate(state, [online], '2026-08-19T04:00:04.000Z', [], { offlineGraceSeconds: 1 })
  const types = state.history.map((event) => event.type)
  assert.ok(types.includes('incident-opened'))
  assert.ok(types.includes('service-status-changed'))
  assert.ok(types.includes('incident-resolved'))
})

test('retiring a removed service closes its open incidents as retired, not recovered, and forgets its observation', () => {
  const config = { offlineGraceSeconds: 0, historyLimit: 50 }
  const offline = { id: 'endpoint-nas', name: 'NAS', host: '10.0.0.5', status: 'offline', detail: 'Timeout', updated: 'now' }
  let { state } = evaluateMonitoring({ state: createEmptyMonitoringState(), overview: { services: [offline] }, config, now: '2026-10-29T00:00:00.000Z' })
  ;({ state } = evaluateMonitoring({ state, overview: { services: [offline] }, config, now: '2026-10-29T00:01:00.000Z' }))
  assert.equal(state.incidents.filter(incident => incident.status === 'open').length, 1)

  const retired = retireService({ state, serviceId: 'endpoint-nas', config, now: '2026-10-29T00:02:00.000Z', reason: 'endpoint check deleted' })
  assert.equal(retired.changed, true)
  const [incident] = retired.state.incidents
  assert.equal(incident.status, 'resolved')
  assert.equal(incident.resolution, 'retired')
  assert.equal(incident.resolvedAt, '2026-10-29T00:02:00.000Z')
  assert.equal(retired.state.observations['endpoint-nas'], undefined)
  const last = retired.state.history.at(-1)
  assert.equal(last.type, 'incident-retired')
  assert.match(last.detail, /endpoint check deleted/)
  assert.ok(!retired.state.history.some(event => event.type === 'incident-resolved'))
  assert.equal(state.incidents[0].status, 'open', 'input state is not mutated')
  assert.equal(retireService({ state: retired.state, serviceId: 'endpoint-nas', config }).changed, false)
})
