import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalRepositoryRegistry, toPublicRepository } from './repository.mjs'

test('loads enabled repository definitions and exposes safe metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'friday-repo-'))
  const repoPath = join(root, 'repo')
  await mkdir(repoPath)
  const registryPath = join(root, 'repositories.json')
  await writeFile(registryPath, JSON.stringify([{ id: 'friday', name: 'Friday', path: repoPath, remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main', mode: 'development', enabled: true }]))
  const registry = new LocalRepositoryRegistry({ registryPath })
  const repository = await registry.get('friday')
  assert.equal(repository.mode, 'development')
  assert.deepEqual(toPublicRepository(repository), { id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main', mode: 'development', enabled: true })
})

test('rejects traversal, absolute paths, secrets, private keys, and symlink escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'friday-repo-'))
  const repoPath = join(root, 'repo')
  await mkdir(join(repoPath, 'config'), { recursive: true })
  await writeFile(join(repoPath, '.env'), 'SECRET=1')
  await writeFile(join(repoPath, '.env.production'), 'SECRET=2')
  await writeFile(join(repoPath, 'config', 'deploy.pem'), 'PRIVATE KEY')
  await writeFile(join(repoPath, 'config', 'id_ed25519'), 'PRIVATE KEY')
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'outside')
  await symlink(outside, join(repoPath, 'escape.txt'))
  const registryPath = join(root, 'repositories.json')
  await writeFile(registryPath, JSON.stringify([{ id: 'friday', name: 'Friday', path: repoPath, defaultBranch: 'main', mode: 'read-only', enabled: true }]))
  const registry = new LocalRepositoryRegistry({ registryPath })
  const repository = await registry.get('friday')
  await assert.rejects(() => registry.resolvePath(repository, '../outside.txt'), /outside repository/i)
  await assert.rejects(() => registry.resolvePath(repository, outside), /outside repository/i)
  await assert.rejects(() => registry.resolvePath(repository, '.env'), /excluded/i)
  await assert.rejects(() => registry.resolvePath(repository, '.env.production'), /excluded/i)
  await assert.rejects(() => registry.resolvePath(repository, 'config/deploy.pem'), /excluded/i)
  await assert.rejects(() => registry.resolvePath(repository, 'config/id_ed25519'), /excluded/i)
  await assert.rejects(() => registry.resolvePath(repository, 'escape.txt'), /outside repository/i)
})
