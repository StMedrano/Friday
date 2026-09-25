import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalRouter, routeAgent } from './orchestrator.mjs'

const agents = [
  {
    id: 'proxmox-observer',
    name: 'Proxmox Observer',
    description: 'Proxmox inventory and diagnostics',
    enabled: true,
    scope: { hosts: ['proxmox'] },
  },
  {
    id: 'disabled-agent',
    name: 'Disabled',
    description: 'Not eligible',
    enabled: false,
    scope: { hosts: ['disabled'] },
  },
]

test('explicit enabled agent override wins without local routing', async () => {
  let routerCalled = false
  const result = await routeAgent({
    prompt: 'check anything',
    requestedAgentId: 'proxmox-observer',
    agents,
    localRouter: async () => { routerCalled = true; return 'NO_MATCH' },
  })

  assert.equal(routerCalled, false)
  assert.deepEqual(result, {
    matched: true,
    agentId: 'proxmox-observer',
    agentName: 'Proxmox Observer',
    routing: 'manual',
    confidence: 1,
    reason: 'Explicit agent override.',
  })
})

test('disabled explicit agent fails closed and is never selected', async () => {
  const result = await routeAgent({ prompt: 'check it', requestedAgentId: 'disabled-agent', agents })
  assert.deepEqual(result, {
    matched: false,
    routing: 'none',
    confidence: 0,
    reason: 'Requested agent is unavailable.',
  })
})

test('strong Proxmox and LXC language routes deterministically', async () => {
  for (const prompt of ['Check Proxmox health', 'What is wrong with LXC 108?', 'Inspect CT108 on Proxmox']) {
    const result = await routeAgent({ prompt, agents })
    assert.equal(result.matched, true)
    assert.equal(result.agentId, 'proxmox-observer')
    assert.equal(result.routing, 'deterministic')
    assert.equal(result.confidence, 0.98)
  }
})

test('generic server language is not enough to force a Proxmox match', async () => {
  const result = await routeAgent({ prompt: 'How is my server doing?', agents })
  assert.equal(result.matched, false)
  assert.equal(result.routing, 'none')
})

test('ambiguous requests may use local router with enabled registered candidates only', async () => {
  let seenCandidates
  const result = await routeAgent({
    prompt: 'Check the virtualization host resources',
    agents,
    localRouter: async ({ candidates }) => {
      seenCandidates = candidates
      return 'proxmox-observer'
    },
  })

  assert.deepEqual(seenCandidates.map((agent) => agent.id), ['proxmox-observer'])
  assert.equal(result.matched, true)
  assert.equal(result.agentId, 'proxmox-observer')
  assert.equal(result.routing, 'local-router')
})

test('unknown local-router output is rejected instead of invented', async () => {
  const result = await routeAgent({
    prompt: 'Check virtualization',
    agents,
    localRouter: async () => 'made-up-agent',
  })
  assert.deepEqual(result, {
    matched: false,
    routing: 'none',
    confidence: 0,
    reason: 'No safe agent match.',
  })
})

test('local-router failure returns safe router-unavailable result without guessing', async () => {
  const result = await routeAgent({
    prompt: 'Check virtualization',
    agents,
    localRouter: async () => { throw new Error('network secret details') },
  })
  assert.deepEqual(result, {
    matched: false,
    routing: 'none',
    confidence: 0,
    reason: 'Local agent router unavailable.',
  })
  assert.equal(JSON.stringify(result).includes('network secret details'), false)
})

test('CT108 local router returns only an exact candidate id or NO_MATCH', async () => {
  const requests = []
  const localRouter = createLocalRouter({
    modelProfile: {
      id: 'local-router',
      provider: 'ollama',
      baseUrl: 'http://192.168.1.70:11434',
      model: 'qwen3:4b-instruct',
      context: 8192,
      maxTokens: 128,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return {
        ok: true,
        status: 200,
        async json() { return { message: { content: 'proxmox-observer' } } },
      }
    },
  })

  const selected = await localRouter({ prompt: 'virtualization health', candidates: [agents[0]] })
  assert.equal(selected, 'proxmox-observer')
  assert.equal(requests[0].url, 'http://192.168.1.70:11434/api/chat')
  const body = JSON.parse(requests[0].options.body)
  assert.equal(body.model, 'qwen3:4b-instruct')
  assert.match(body.messages[0].content, /Return exactly one candidate agent ID or NO_MATCH/i)
})
