import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'

function config() {
  return {
    mode: 'live',
    port: 3010,
    monitoring: { enabled: false, statePath: '/tmp/unused.json' },
    diagnostics: { enabled: false },
    agents: { enabled: true },
    ai: { enabled: false },
  }
}

function overview() {
  return { mode: 'live', generatedAt: 'fresh-state', sites: [], services: [{ id: 'proxmox-qemu-100', status: 'online' }], alerts: [], resources: [], activities: [], integrations: [] }
}

function registry() {
  return {
    async list() { return [{ id: 'proxmox-observer', name: 'Proxmox Observer', enabled: true }] },
    async get(id) { return id === 'proxmox-observer' ? { id, name: 'Proxmox Observer', enabled: true } : null },
    async status() { return { id: 'current', status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] } },
    async sync() { return { status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] } },
  }
}

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try { return await fn(`http://127.0.0.1:${port}`) } finally {
    server.close()
    await once(server, 'close')
  }
}

async function post(base, path, body = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('agent registry GET endpoints expose sanitized list detail and status', async () => {
  await withServer({ config: config(), agentRegistryService: registry(), buildOverviewImpl: async () => overview() }, async (base) => {
    const list = await fetch(`${base}/api/agents`)
    assert.equal(list.status, 200)
    assert.equal((await list.json())[0].id, 'proxmox-observer')

    const detail = await fetch(`${base}/api/agents/proxmox-observer`)
    assert.equal(detail.status, 200)
    assert.equal((await detail.json()).name, 'Proxmox Observer')

    const missing = await fetch(`${base}/api/agents/missing`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: 'agent-not-found' })

    const status = await fetch(`${base}/api/agents/registry/status`)
    assert.equal(status.status, 200)
    assert.equal((await status.json()).status, 'ok')
  })
})

test('route and ask POST endpoints validate inputs and pass fresh overview to local agent service', async () => {
  const calls = []
  const agentService = {
    async route(input) { calls.push(['route', input]); return { matched: true, agentId: 'proxmox-observer', routing: 'deterministic' } },
    async ask(id, input) {
      calls.push(['ask', id, input])
      return { available: true, agentId: id, provider: 'ollama', mode: 'local-agent', text: 'healthy', execution: { performed: false } }
    },
  }

  await withServer({
    config: config(),
    agentRegistryService: registry(),
    agentService,
    buildOverviewImpl: async () => overview(),
  }, async (base) => {
    const route = await post(base, '/api/agents/route', { prompt: 'Check Proxmox' })
    assert.equal(route.status, 200)
    assert.equal((await route.json()).agentId, 'proxmox-observer')

    const ask = await post(base, '/api/agents/proxmox-observer/ask', { prompt: 'Check VM 100' })
    assert.equal(ask.status, 200)
    assert.equal((await ask.json()).provider, 'ollama')
    assert.equal(calls[1][1], 'proxmox-observer')
    assert.equal(calls[1][2].prompt, 'Check VM 100')
    assert.equal(calls[1][2].overview.generatedAt, 'fresh-state')

    const tooLong = await post(base, '/api/agents/route', { prompt: 'x'.repeat(4001) })
    assert.equal(tooLong.status, 400)
    assert.equal((await tooLong.json()).error, 'invalid-prompt')
  })
})

test('registry synchronization is operator-token protected and fails closed before side effects', async () => {
  const validToken = 'a'.repeat(64)
  let syncCalls = 0
  const registryService = registry()
  registryService.sync = async () => { syncCalls += 1; return { status: 'ok', agentsSynced: 1 } }
  for (const [configuredToken, authHeader, expected] of [
    [undefined, undefined, 503],
    [validToken, undefined, 401],
    [validToken, 'Bearer ' + 'b'.repeat(64), 401],
    [validToken, 'Basic ' + validToken, 401],
    [validToken, 'Bearer ' + validToken, 200],
  ]) {
    await withServer({
      config: { ...config(), operator: { registrySyncToken: configuredToken } },
      agentRegistryService: registryService,
      buildOverviewImpl: async () => overview(),
    }, async (base) => {
      const res = await fetch(base + '/api/agents/registry/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authHeader ? { authorization: authHeader } : {}) },
        body: '{}',
      })
      assert.equal(res.status, expected, 'expected status ' + expected)
      assert.equal(syncCalls, expected === 200 ? 1 : 0, 'only authenticated sync executes')
      if (expected === 200) {
        const invalid = await fetch(base + '/api/agents/registry/sync', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: authHeader },
          body: '{"force":true}',
        })
        assert.equal(invalid.status, 400)
        assert.equal(syncCalls, 1)
      }
    })
  }
})

test('agent endpoints fail closed when registry/service is unavailable and sanitize faults', async () => {
  await withServer({ config: config(), buildOverviewImpl: async () => overview() }, async (base) => {
    for (const [path, method] of [['/api/agents', 'GET'], ['/api/agents/registry/status', 'GET'], ['/api/agents/route', 'POST']]) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ prompt: 'check' }) : undefined })
      assert.equal(response.status, 503)
    }
  })

  await withServer({
    config: config(),
    agentRegistryService: { ...registry(), async list() { throw new Error('supabase secret details') } },
    buildOverviewImpl: async () => overview(),
  }, async (base) => {
    const response = await fetch(`${base}/api/agents`)
    assert.equal(response.status, 503)
    const body = await response.json()
    assert.deepEqual(body, { error: 'agent-registry-unavailable' })
    assert.equal(JSON.stringify(body).includes('secret'), false)
  })
})

test('agent HTTP surface exposes no mutation or execution routes', async () => {
  await withServer({ config: config(), agentRegistryService: registry(), buildOverviewImpl: async () => overview() }, async (base) => {
    const requests = [
      ['PUT', '/api/agents/proxmox-observer'],
      ['PATCH', '/api/agents/proxmox-observer'],
      ['DELETE', '/api/agents/proxmox-observer'],
      ['POST', '/api/agents/proxmox-observer/restart'],
      ['POST', '/api/agents/proxmox-observer/execute'],
      ['POST', '/api/agents/proxmox-observer/tool'],
    ]
    for (const [method, path] of requests) {
      const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
      assert.equal(response.status, 404, `${method} ${path} must not exist`)
      assert.deepEqual(await response.json(), { error: 'not-found' })
    }
  })
})

test('Phase 2B does not expose public task, memory, handoff or decision operations',async()=>{
 await withServer({
  config:config(),
  agentRegistryService:registry(),
  buildOverviewImpl:async()=>overview()
 },async(base)=>{
  for(const route of ['/api/work','/api/work/claims','/api/memory','/api/handoffs','/api/decisions']){
   for(const method of ['GET','POST','PATCH','DELETE']){
    const response=await fetch(base+route,{
     method,headers:{'content-type':'application/json'},
     ...(method==='GET'?{}:{body:JSON.stringify({actor:{principalId:'admin'},operation:'execute'})})
    })
    assert.equal(response.status,404,method+' '+route+' unexpectedly exposed')
    assert.deepEqual(await response.json(),{error:'not-found'})
   }
  }
 })
})
test('Phase 2C adds no public policy, plugin, context or MCP write endpoints',async()=>{
 await withServer({config:config(),agentRegistryService:registry(),buildOverviewImpl:async()=>overview()},async(base)=>{
  for(const route of ['/api/policy','/api/plugins','/api/context','/api/fabric','/api/work','/api/memory','/mcp']){
   for(const method of ['POST','PUT','PATCH','DELETE']){
    const response=await fetch(base+route,{method,headers:{'content-type':'application/json'},body:'{}'})
    assert.equal(response.status,404,method+' '+route)
   }
  }
 })
})
