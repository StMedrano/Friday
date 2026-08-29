import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { LocalRepositoryRegistry } from '../repositories/repository.mjs'
import { ToolRegistry, executeAgentTool } from './tool-registry.mjs'
import { registerRepositoryTools } from './repository-tools.mjs'

const execFile = promisify(execFileCallback)
const agent = {
  tools: ['repo.status', 'repo.list', 'repo.read', 'repo.search', 'repo.history', 'repo.manifest'],
  permissions: { inspect_repository: 'auto' },
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'friday-tools-'))
  const repo = join(root, 'repo')
  await mkdir(join(repo, 'src'), { recursive: true })
  await mkdir(join(repo, 'config'), { recursive: true })
  await writeFile(join(repo, 'src', 'assistant.mjs'), "export const handler = 'assistant request'\n")
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }))
  await writeFile(join(repo, '.env'), 'TOKEN=secret')
  await writeFile(join(repo, 'config', '.env.local'), 'TOKEN=nested-secret')
  await writeFile(join(repo, 'big.txt'), 'x'.repeat(140 * 1024))
  await execFile('git', ['init'], { cwd: repo })
  await execFile('git', ['config', 'user.email', 'friday@example.invalid'], { cwd: repo })
  await execFile('git', ['config', 'user.name', 'Friday Test'], { cwd: repo })
  await execFile('git', ['add', 'src/assistant.mjs', 'package.json'], { cwd: repo })
  await execFile('git', ['commit', '-m', 'fixture'], { cwd: repo })
  const registryPath = join(root, 'repositories.json')
  await writeFile(registryPath, JSON.stringify([{ id: 'fixture', name: 'Fixture', path: repo, defaultBranch: 'main', mode: 'read-only', enabled: true }]))
  const registry = new LocalRepositoryRegistry({ registryPath })
  const tools = new ToolRegistry()
  registerRepositoryTools({ registry, toolRegistry: tools })
  return { registry, tools }
}

async function execute(tools, tool, args = {}) {
  return executeAgentTool({ registry: tools, agent, request: { tool, args: { repositoryId: 'fixture', ...args } } })
}

test('Explorer tools list, read, search, inspect manifest and history', async () => {
  const { tools } = await fixture()
  const list = await execute(tools, 'repo.list')
  assert.equal(list.status, 'completed')
  assert.ok(list.output.entries.some((entry) => entry.path === 'src'))
  assert.ok(!list.output.entries.some((entry) => entry.path === '.env'))
  assert.ok(!list.output.entries.some((entry) => entry.path === '.git'))

  const read = await execute(tools, 'repo.read', { path: 'src/assistant.mjs' })
  assert.match(read.output.text, /assistant request/)

  const search = await execute(tools, 'repo.search', { query: 'assistant request' })
  assert.equal(search.output.results[0].path, 'src/assistant.mjs')

  const manifest = await execute(tools, 'repo.manifest')
  assert.equal(manifest.output.manifests[0].data.name, 'fixture')

  const history = await execute(tools, 'repo.history')
  assert.ok(history.output.entries.some((entry) => entry.subject === 'fixture'))
})

test('Explorer tools block secrets and traversal and bound large reads', async () => {
  const { tools } = await fixture()
  assert.equal((await execute(tools, 'repo.read', { path: '.env' })).status, 'failed')
  assert.equal((await execute(tools, 'repo.read', { path: 'config/.env.local' })).status, 'failed')
  assert.equal((await execute(tools, 'repo.read', { path: '../outside.txt' })).status, 'failed')
  const big = await execute(tools, 'repo.read', { path: 'big.txt' })
  assert.equal(big.status, 'completed')
  assert.equal(big.output.truncated, true)
  assert.ok(big.output.text.length <= 128 * 1024)
})
