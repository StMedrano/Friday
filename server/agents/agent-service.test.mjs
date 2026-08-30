import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentService } from './agent-service.mjs'

const agent = {
  version: '1.1',
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  description: 'Read-only Proxmox diagnostics.',
  enabled: true,
  model: { profile: 'local-general' },
  scope: { hosts: ['proxmox'] },
  tools: ['proxmox_read'],
  permissions: { inspect: 'auto' },
  instructions: ['Inspect first.'],
}

function registry(overrides = {}) {
  return {
    async list() { return [agent] },
    async get(id) { return id === agent.id ? agent : null },
    ...overrides,
  }
}

const config = {
  agents: {
    modelProfiles: {
      'local-router': { provider: 'ollama', baseUrl: 'http://ct108:11434', model: 'router', context: 8192, maxTokens: 128 },
      'local-general': { provider: 'ollama', baseUrl: 'http://ct108:11434', model: 'qwen3:4b-instruct', context: 8192, maxTokens: 768 },
    },
  },
  ai: {
    providerOrder: ['groq', 'gemini', 'ollama'],
    providers: { groq: { apiKey: 'must-not-use' }, gemini: { apiKey: 'must-not-use' } },
  },
}

test('agent service routes only across registered agents and local router profile', async () => {
  let seen
  const service = createAgentService({
    registryService: registry(),
    config,
    routeAgentImpl: async (input) => { seen = input; return { matched: true, agentId: 'proxmox-observer', routing: 'manual' } },
    createLocalRouterImpl: ({ modelProfile }) => {
      assert.equal(modelProfile.model, 'router')
      return async () => 'NO_MATCH'
    },
  })

  const result = await service.route({ prompt: 'Check Proxmox', requestedAgentId: 'proxmox-observer' })
  assert.equal(result.agentId, 'proxmox-observer')
  assert.deepEqual(seen.agents, [agent])
  assert.equal(typeof seen.localRouter, 'function')
})

test('agent ask uses fresh authoritative overview and only the agent model profile', async () => {
  let seen
  const overview = { mode: 'live', services: [{ id: 'proxmox-qemu-100', status: 'online' }] }
  const service = createAgentService({
    registryService: registry(),
    config,
    runLocalAgentImpl: async (input) => {
      seen = input
      return { provider: 'ollama', model: 'qwen3:4b-instruct', text: 'VM 100 is online.' }
    },
  })

  const result = await service.ask('proxmox-observer', { prompt: 'Check VM 100', overview })

  assert.equal(seen.agent.id, 'proxmox-observer')
  assert.equal(seen.modelProfile.id, 'local-general')
  assert.equal(seen.modelProfile.baseUrl, 'http://ct108:11434')
  assert.deepEqual(seen.overview, overview)
  assert.equal('ai' in seen, false)
  assert.deepEqual(result, {
    available: true,
    agentId: 'proxmox-observer',
    agentName: 'Proxmox Observer',
    provider: 'ollama',
    modelProfile: 'local-general',
    model: 'qwen3:4b-instruct',
    mode: 'local-agent',
    text: 'VM 100 is online.',
    execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
  })
})

test('matched local agent succeeds while configured cloud providers remain completely unused', async () => {
  let localCalls = 0
  let cloudCalls = 0
  const cloudProvider = async () => { cloudCalls += 1; return { text: 'must not run' } }
  const service = createAgentService({
    registryService: registry(),
    config: { ...config, cloudProvider },
    runLocalAgentImpl: async () => {
      localCalls += 1
      return { provider: 'ollama', model: 'qwen3:4b-instruct', text: 'Local-only answer.' }
    },
  })

  const result = await service.ask('proxmox-observer', { prompt: 'Inspect Proxmox', overview: { mode: 'live' } })
  assert.equal(localCalls, 1)
  assert.equal(cloudCalls, 0)
  assert.equal(result.provider, 'ollama')
  assert.equal(result.mode, 'local-agent')
  assert.equal(result.text, 'Local-only answer.')
})

test('action-like restart prompt remains advisory and exposes no executor path', async () => {
  let seen
  const service = createAgentService({
    registryService: registry(),
    config,
    runLocalAgentImpl: async (input) => {
      seen = input
      return { provider: 'ollama', model: 'qwen3:4b-instruct', text: 'I can describe restart checks, but I cannot execute them.' }
    },
  })

  const result = await service.ask('proxmox-observer', {
    prompt: 'Restart VM 100 now',
    overview: { mode: 'live', services: [{ id: 'proxmox-qemu-100', status: 'offline' }] },
  })

  assert.equal('executor' in seen, false)
  assert.equal('execute' in seen, false)
  assert.deepEqual(result.execution, { performed: false, reason: 'Phase 1 agents are advisory only.' })
  assert.equal(result.mode, 'local-agent')
})

test('missing or disabled agent fails before local inference', async () => {
  let calls = 0
  const service = createAgentService({
    registryService: registry({ async get() { return null } }),
    config,
    runLocalAgentImpl: async () => { calls += 1 },
  })
  assert.deepEqual(await service.ask('missing', { prompt: 'check', overview: {} }), {
    available: false,
    error: 'agent-unavailable',
    reason: 'Requested agent is unavailable.',
    execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
  })
  assert.equal(calls, 0)
})

test('local model failure never falls back to cloud providers and returns sanitized local error', async () => {
  let calls = 0
  const service = createAgentService({
    registryService: registry(),
    config,
    runLocalAgentImpl: async () => { calls += 1; throw new Error('Groq key secret and CT108 internals') },
  })

  const result = await service.ask('proxmox-observer', { prompt: 'Check it', overview: {} })
  assert.equal(calls, 1)
  assert.deepEqual(result, {
    available: false,
    error: 'local-agent-unavailable',
    agentId: 'proxmox-observer',
    agentName: 'Proxmox Observer',
    reason: 'Local agent inference unavailable.',
    execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
  })
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
