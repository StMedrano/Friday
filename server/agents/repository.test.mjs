import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalAgentRepository, createAgentRepositoryFromEnv } from './repository.mjs'

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'friday-agents-'))
  const directory = path.join(root, 'agents')
  const cachePath = path.join(root, 'data', 'agents-cache.json')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'alpha.json'), JSON.stringify({ id: 'alpha', name: 'Alpha', enabled: true }))
  await fs.writeFile(path.join(directory, 'disabled.json'), JSON.stringify({ id: 'disabled', name: 'Disabled', enabled: false }))
  return { root, directory, cachePath }
}

test('local repository lists enabled JSON agents and gets by id', async t => {
  const fixture = await makeFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const repo = new LocalAgentRepository(fixture)
  const agents = await repo.list()
  assert.deepEqual(agents.map(agent => agent.id), ['alpha'])
  assert.equal((await repo.get('alpha')).name, 'Alpha')
  assert.equal(await repo.get('missing'), null)
})

test('local repository writes and reads cache without external services', async t => {
  const fixture = await makeFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  const repo = new LocalAgentRepository(fixture)
  await repo.writeCache([{ id: 'cached-agent' }])
  assert.deepEqual(await repo.readCache(), [{ id: 'cached-agent' }])
})

test('environment factory remains local-only', () => {
  const repo = createAgentRepositoryFromEnv({
    FRIDAY_AGENT_LOCAL_DIR: './custom-agents',
    FRIDAY_AGENT_CACHE_PATH: './custom-data/cache.json',
    SUPABASE_URL: 'https://should-not-be-used.example',
  })
  assert.ok(repo instanceof LocalAgentRepository)
  assert.equal(repo.directory, './custom-agents')
  assert.equal(repo.cachePath, './custom-data/cache.json')
})
