import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'
import { getConfig } from './config.mjs'

const config = getConfig({ FRIDAY_MODE: 'live' })
const operator = { status: 200, identity: { subject: 'person-1', email: 'operator@example.test' } }
const input = {
  id: 'dns-watcher', name: 'DNS Watcher', description: 'Watches AdGuard health.', profile: 'local-general',
  tools: ['dns_read'], permissions: { inspect: 'auto', restart_service: 'approval' }, instructions: ['Inspect first.'],
}

function proposer({ enabled = true, calls = [], propose } = {}) {
  return { enabled, repository: enabled ? 'StMedrano/Friday' : null,
    propose: propose || (async (definition) => { calls.push(definition); return { number: 7, url: 'https://github.com/StMedrano/Friday/pull/7', branch: 'friday/agent-dns-watcher-x', path: 'agents/dns-watcher.json' } }) }
}

async function run({ agentProposer, gate = async () => operator, actionAudit = null, mode = 'live' }, check) {
  const server = createFridayServer({ config: { ...config, mode }, agentProposer, actionAudit, accessGateImpl: gate })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  try { await check(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise((resolve) => server.close(resolve)) }
}
const post = (base, body = input, headers = {}) => fetch(`${base}/api/agents/proposals`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

test('proposals answer 503 when off, and never reach GitHub', async () => {
  const calls = []
  await run({ agentProposer: proposer({ enabled: false, calls }) }, async (base) => {
    assert.equal((await fetch(`${base}/api/agents/proposals`)).status, 503)
    const response = await post(base)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'agent-proposals-disabled' })
  })
  assert.equal(calls.length, 0)
})

test('the default proposer is off with the default config', async () => {
  await run({}, async (base) => { assert.equal((await fetch(`${base}/api/agents/proposals`)).status, 503) })
})

test('lists the repository and the local profiles a proposal may use', async () => {
  await run({ agentProposer: proposer() }, async (base) => {
    const response = await fetch(`${base}/api/agents/proposals`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { repository: 'StMedrano/Friday', profiles: ['local-general', 'local-coder'] })
  })
})

test('an operator opens a pull request; operator-only, JSON-only, audited', async () => {
  const calls = [], gateCalls = [], audit = []
  const actionAudit = { async record(entry) { audit.push(entry); return { requestId: '11111111-1111-4111-8111-111111111111' } } }
  await run({ agentProposer: proposer({ calls }), actionAudit, gate: async (_request, operatorOnly) => { gateCalls.push(operatorOnly); return operator } }, async (base) => {
    const response = await post(base)
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { proposal: { number: 7, url: 'https://github.com/StMedrano/Friday/pull/7', branch: 'friday/agent-dns-watcher-x', path: 'agents/dns-watcher.json' } })
    assert.equal((await post(base, input, { 'content-type': 'text/plain' })).status, 415)
    assert.equal((await post(base, input, { 'sec-fetch-site': 'cross-site' })).status, 403)
  })
  assert.deepEqual(gateCalls, [true, true, true])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].version, '1.1')
  assert.deepEqual(audit.map((entry) => [entry.action, entry.phase, entry.target]), [['agents.propose', 'requested', 'dns-watcher'], ['agents.propose', 'succeeded', 'dns-watcher']])
})

test('non-operators, service tokens and mock mode cannot propose', async () => {
  const calls = []
  await run({ agentProposer: proposer({ calls }), gate: async (_request, operatorOnly) => operatorOnly ? { status: 403 } : operator }, async (base) => {
    assert.equal((await post(base)).status, 403)
  })
  await run({ agentProposer: proposer({ calls }), gate: async () => ({ status: 200, identity: { kind: 'service', subject: 'svc' } }) }, async (base) => {
    assert.equal((await post(base)).status, 403)
  })
  await run({ agentProposer: proposer({ calls }), mode: 'mock' }, async (base) => {
    assert.equal((await post(base)).status, 403)
  })
  assert.equal(calls.length, 0)
})

test('bad input is 400 with the field, before any GitHub call', async () => {
  const calls = []
  await run({ agentProposer: proposer({ calls }) }, async (base) => {
    for (const [body, field] of [[{ ...input, profile: 'local-router' }, 'profile'], [{ ...input, permissions: { restart_vm: 'auto' } }, 'permissions'],
      [{ ...input, id: 'Bad' }, 'id'], [{ ...input, extra: 1 }, 'fields']]) {
      const response = await post(base, body)
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), { error: 'invalid-agent-proposal', field })
    }
    assert.equal((await post(base, 'not json')).status, 400)
    assert.equal((await fetch(`${base}/api/agents/proposals?x=1`)).status, 400)
    assert.equal((await fetch(`${base}/api/agents/proposals`, { method: 'DELETE' })).status, 405)
  })
  assert.equal(calls.length, 0)
})

test('GitHub refusals are mapped and sanitized', async () => {
  for (const [code, status, error] of [['exists', 409, 'agent-exists'], ['github-denied', 502, 'github-denied'], ['github-rejected', 409, 'github-rejected'], [undefined, 503, 'github-unavailable']]) {
    const agentProposer = proposer({ propose: async () => { const failure = Error('token ghp_secret'); failure.code = code; throw failure } })
    await run({ agentProposer }, async (base) => {
      const response = await post(base)
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), { error })
    })
  }
})
