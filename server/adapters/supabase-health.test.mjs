import test from 'node:test'
import assert from 'node:assert/strict'
import {getConfig} from '../config.mjs'
import {buildOverview} from '../overview.mjs'
import {getSupabaseHealthServices} from './supabase-health.mjs'

const config = {enabled: true, supabaseUrl: 'https://supabase.example.test/', serviceKey: 'service-secret', site: 'Home'}
const reply = (status, body = []) => async () => new Response(JSON.stringify(body), {status})

test('reports online when PostgREST returns rows and probes one bounded read with server-side credentials', async () => {
  const calls = []
  const services = await getSupabaseHealthServices(config, {fetchImpl: async (url, options) => { calls.push([url, options]); return new Response('[{"id":"proxmox-observer"}]', {status: 200}) }})
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'https://supabase.example.test/rest/v1/friday_agents?select=id&limit=1')
  assert.equal(calls[0][1].method, 'GET')
  assert.equal(calls[0][1].headers.apikey, 'service-secret')
  assert.deepEqual(services, [{id: 'vm132-supabase', name: 'Supabase database (VM132)', category: 'database', host: 'supabase-prod', site: 'Home', status: 'online', detail: 'PostgREST and PostgreSQL answering', updated: 'live'}])
})

test('reports offline for server errors and failures, degraded for other statuses, without leaking secrets', async () => {
  assert.equal((await getSupabaseHealthServices(config, {fetchImpl: reply(503, {message: 'could not open file pg_filenode.map'})}))[0].status, 'offline')
  assert.equal((await getSupabaseHealthServices(config, {fetchImpl: reply(401)}))[0].status, 'degraded')
  const failed = await getSupabaseHealthServices(config, {fetchImpl: async () => { throw new Error('connect ECONNREFUSED https://supabase.example.test service-secret') }})
  assert.equal(failed[0].status, 'offline')
  assert.equal(failed[0].detail, 'Unreachable')
  const timedOut = await getSupabaseHealthServices(config, {fetchImpl: async () => { throw Object.assign(new Error('x'), {name: 'TimeoutError'}) }})
  assert.equal(timedOut[0].detail, 'Timed out')
  for (const service of [...failed, ...timedOut]) assert.doesNotMatch(JSON.stringify(service), /secret|example\.test|pg_filenode/)
})

test('confirms an outage with a second attempt so one lost request is not reported as a drop', async () => {
  // The path to VM132 loses a single probe near the top of most hours. One lost
  // probe used to write two state transitions, and three in 15 minutes opens a
  // flapping incident, so the recovery must happen inside the same poll.
  const outcomes = [() => { throw Object.assign(new Error('x'), {name: 'TimeoutError'}) }, () => new Response('[]', {status: 200})]
  const calls = []
  const services = await getSupabaseHealthServices(config, {fetchImpl: async (url, options) => { calls.push(url); return outcomes[calls.length - 1]() }})
  assert.equal(calls.length, 2)
  assert.equal(services[0].status, 'online')
  assert.equal(services[0].detail, 'PostgREST and PostgreSQL answering')
})

test('reports a sustained outage on the same poll, within a bounded number of attempts', async () => {
  let calls = 0
  const services = await getSupabaseHealthServices(config, {fetchImpl: async () => { calls += 1; throw new Error('connect ECONNREFUSED') }})
  assert.equal(calls, 2)
  assert.equal(services[0].status, 'offline')
  assert.equal(services[0].detail, 'Unreachable')
})

test('does not retry a stable configuration failure, and the attempts share the caller budget', async () => {
  const rejected = []
  await getSupabaseHealthServices(config, {fetchImpl: async (url, options) => { rejected.push(options.signal); return new Response('{}', {status: 401}) }})
  assert.equal(rejected.length, 1, 'a 4xx answer is not worth asking twice')

  // Both attempts come out of the caller's one budget, so a host that accepts
  // the connection and then never answers cannot stall the poll for twice as long.
  let hung = 0
  const started = Date.now()
  const keepAlive = setInterval(() => {}, 5) // AbortSignal.timeout does not hold the loop open on its own.
  const services = await getSupabaseHealthServices(config, {
    timeoutMs: 200,
    fetchImpl: (url, options) => new Promise((resolve, reject) => {
      hung += 1
      options.signal.addEventListener('abort', () => reject(options.signal.reason))
    }),
  }).finally(() => clearInterval(keepAlive))
  assert.equal(hung, 2)
  assert.ok(Date.now() - started < 400, 'two attempts must fit inside the single budget')
  assert.equal(services[0].status, 'offline')
  assert.equal(services[0].detail, 'Timed out')
})

test('is skipped when disabled or unconfigured', async () => {
  const never = async () => { throw new Error('must not fetch') }
  assert.deepEqual(await getSupabaseHealthServices({...config, enabled: false}, {fetchImpl: never}), [])
  assert.deepEqual(await getSupabaseHealthServices({...config, serviceKey: ''}, {fetchImpl: never}), [])
})

test('config enables the probe with the agent registry unless explicitly disabled', () => {
  const env = {FRIDAY_AGENT_REGISTRY_ENABLED: 'true', FRIDAY_SUPABASE_URL: 'https://s.test', FRIDAY_SUPABASE_SERVICE_KEY: 'k'}
  const enabled = getConfig(env).supabaseHealth
  assert.equal(enabled.enabled, getConfig(env).agents.registry.enabled)
  assert.equal(enabled.supabaseUrl, 'https://s.test')
  assert.equal(enabled.site, 'Site A')
  assert.equal(getConfig({...env, FRIDAY_SUPABASE_HEALTH_ENABLED: 'false'}).supabaseHealth.enabled, false)
  assert.equal(getConfig({...env, FRIDAY_SUPABASE_SITE: 'Home'}).supabaseHealth.site, 'Home')
})

test('live overview includes the Supabase health service so monitoring can open an incident', async () => {
  const overview = await buildOverview({...getConfig({FRIDAY_MODE: 'live'}), supabaseHealth: config}, {
    getDockerServices: async () => [], getProxmoxServices: async () => [], getVm100ObserverServices: async () => [], getEndpointServices: async () => [],
    getSupabaseHealthServices: async () => [{id: 'vm132-supabase', status: 'offline', site: 'Home'}],
  })
  assert.equal(overview.services.find(service => service.id === 'vm132-supabase').status, 'offline')
  assert.equal(overview.integrations.find(item => item.id === 'supabase').enabled, true)
})
