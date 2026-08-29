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
  try { await fn(`http://127.0.0.1:${port}`) } finally { server.close(); await once(server, 'close') }
}

async function post(base, body) {
  return fetch(`${base}/api/agents/explore`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

test('POST /api/agents/explore returns deterministic Explorer result', async () => {
  const agentOrchestrator = { analyzeRepository: async ({ repositoryId, prompt }) => ({ id: 't1', repositoryId, agentId: 'codebase-explorer', status: 'COMPLETED', states: ['QUEUED','ANALYZING','COMPLETED'], answer: `checked:${prompt}`, toolEvents: [] }) }
  await withServer({ config, agentOrchestrator }, async (base) => {
    const response = await post(base, { repositoryId: 'friday', prompt: 'Find assistant handler' })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.agentId, 'codebase-explorer')
    assert.equal(body.repositoryId, 'friday')
  })
})

test('Explorer endpoint validates request and maps missing repository to 404', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'FRIDAY_REPOSITORY_NOT_FOUND' })
  const agentOrchestrator = { analyzeRepository: async () => { throw missing } }
  await withServer({ config, agentOrchestrator }, async (base) => {
    assert.equal((await post(base, { repositoryId: '../bad', prompt: 'inspect' })).status, 400)
    assert.equal((await post(base, { repositoryId: 'friday', prompt: '' })).status, 400)
    assert.equal((await post(base, { repositoryId: 'friday', prompt: 'x'.repeat(4001) })).status, 400)
    assert.equal((await post(base, { repositoryId: 'missing', prompt: 'inspect' })).status, 404)
  })
})

test('no generic agent action endpoint is exposed', async () => {
  await withServer({ config, agentOrchestrator: { analyzeRepository: async () => ({}) } }, async (base) => {
    const response = await fetch(`${base}/api/agents/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 404)
  })
})
