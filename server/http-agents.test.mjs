import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createFridayServer } from './http.mjs'

const config = { mode: 'live', port: 3010, monitoring: { enabled: false }, ai: { enabled: false } }

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  try { await fn(`http://127.0.0.1:${port}`) } finally {
    server.close()
    await once(server, 'close')
  }
}

test('agent and repository inventory endpoints expose safe metadata only', async () => {
  const agentRepository = { list: async () => [{
    id: 'codebase-explorer', name: 'Codebase Explorer', description: 'read only',
    model: { provider: 'ollama', model: 'qwen', baseUrl: 'http://secret-host:11434' },
    tools: ['repo.read'], permissions: { inspect_repository: 'auto' }, scope: { hosts: ['controller'] },
    instructions: ['internal prompt'],
  }] }
  const repositoryRegistry = {
    list: async () => [{ id: 'friday', name: 'Friday', path: '/srv/private/friday', remote: 'git@example/friday', defaultBranch: 'main', mode: 'development', enabled: true }],
  }
  await withServer({ config, agentRepository, repositoryRegistry }, async (base) => {
    const agentsResponse = await fetch(`${base}/api/agents`)
    assert.equal(agentsResponse.status, 200)
    const agents = await agentsResponse.json()
    assert.equal(agents.agents[0].id, 'codebase-explorer')
    assert.equal('instructions' in agents.agents[0], false)
    assert.equal('baseUrl' in agents.agents[0].model, false)

    const reposResponse = await fetch(`${base}/api/repositories`)
    assert.equal(reposResponse.status, 200)
    const repos = await reposResponse.json()
    assert.equal(repos.repositories[0].id, 'friday')
    assert.equal('path' in repos.repositories[0], false)
  })
})

test('inventory collection routes expose no mutation methods', async () => {
  const agentRepository = { list: async () => [] }
  const repositoryRegistry = { list: async () => [] }
  await withServer({ config, agentRepository, repositoryRegistry }, async (base) => {
    for (const route of ['/api/agents', '/api/repositories']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
        assert.equal(response.status, 404, `${method} ${route} must remain unavailable`)
      }
    }
  })
})
