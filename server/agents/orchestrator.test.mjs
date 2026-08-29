import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolRegistry } from '../ai/tool-registry.mjs'
import { createAgentOrchestrator } from './orchestrator.mjs'

function explorerAgent() {
  return {
    id: 'codebase-explorer', name: 'Codebase Explorer', description: 'read only',
    model: { provider: 'ollama', model: 'qwen' },
    tools: ['repo.status', 'repo.list', 'repo.search', 'repo.manifest'],
    permissions: { inspect_repository: 'auto' },
  }
}

function tools() {
  const registry = new ToolRegistry()
  for (const name of ['repo.status', 'repo.list', 'repo.search', 'repo.manifest']) {
    registry.register({ name, permission: 'inspect_repository', execute: async ({ args }) => ({ name, args }) })
  }
  return registry
}

test('routes registered repository analysis deterministically to Codebase Explorer', async () => {
  let seen = null
  const orchestrator = createAgentOrchestrator({
    agentRepository: { get: async (id) => id === 'codebase-explorer' ? explorerAgent() : null },
    repositoryRegistry: { get: async (id) => id === 'friday' ? { id: 'friday', name: 'Friday', defaultBranch: 'main', mode: 'development', enabled: true } : null },
    toolRegistry: tools(),
    runAgent: async (input) => { seen = input; return { available: true, text: 'The assistant handler is in server/http.mjs.' } },
  })
  const result = await orchestrator.analyzeRepository({ repositoryId: 'friday', prompt: 'Find where assistant requests are handled' })
  assert.equal(result.agentId, 'codebase-explorer')
  assert.equal(result.status, 'COMPLETED')
  assert.deepEqual(result.states, ['QUEUED', 'ANALYZING', 'COMPLETED'])
  assert.equal(result.answer, 'The assistant handler is in server/http.mjs.')
  assert.equal(seen.agent.id, 'codebase-explorer')
  assert.match(seen.overview, /friday/)
  assert.ok(result.toolEvents.length > 0)
})

test('unknown repository fails before model invocation', async () => {
  let calls = 0
  const orchestrator = createAgentOrchestrator({
    agentRepository: { get: async () => explorerAgent() },
    repositoryRegistry: { get: async () => null },
    toolRegistry: tools(),
    runAgent: async () => { calls += 1; return { available: true, text: 'no' } },
  })
  await assert.rejects(() => orchestrator.analyzeRepository({ repositoryId: 'missing', prompt: 'inspect it' }), (error) => error.code === 'FRIDAY_REPOSITORY_NOT_FOUND')
  assert.equal(calls, 0)
})

test('model failure records FAILED terminal state', async () => {
  const orchestrator = createAgentOrchestrator({
    agentRepository: { get: async () => explorerAgent() },
    repositoryRegistry: { get: async () => ({ id: 'friday', name: 'Friday', defaultBranch: 'main', mode: 'read-only', enabled: true }) },
    toolRegistry: tools(),
    runAgent: async () => { throw new Error('ollama unavailable') },
  })
  const result = await orchestrator.analyzeRepository({ repositoryId: 'friday', prompt: 'inspect it' })
  assert.equal(result.status, 'FAILED')
  assert.deepEqual(result.states, ['QUEUED', 'ANALYZING', 'FAILED'])
  assert.equal(result.error, 'agent-failed')
})
