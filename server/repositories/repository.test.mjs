import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { LocalRepositoryRegistry, toPublicRepository } from './repository.mjs'

test('ships a valid but disabled sample registry', async () => {
  const registryPath = fileURLToPath(new URL('../../repositories.example.json', import.meta.url))
  assert.deepEqual(await new LocalRepositoryRegistry({ registryPath }).list(), [])
})

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'friday-repositories-'))
  const root = join(dir, 'checkout')
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'index.mjs'), 'export const safe = true\n')
  await writeFile(join(root, 'README.md'), 'fixture\n')
  await writeFile(join(root, '.env.production'), 'fixture-secret\n')
  const registryPath = join(dir, 'repositories.json')
  await writeFile(registryPath, JSON.stringify([{
    id: 'friday', name: 'Friday', path: root, remote: 'https://github.com/StMedrano/Friday.git',
    defaultBranch: 'main', mode: 'read-only', enabled: true,
  }]))
  try { await fn({ dir, root, registry: new LocalRepositoryRegistry({ registryPath }) }) }
  finally { await rm(dir, { recursive: true, force: true }) }
}

test('loads only enabled Git repositories and returns safe public metadata', async () => {
  await fixture(async ({ registry, root }) => {
    const repo = await registry.get('friday')
    assert.equal(repo.path, root)
    assert.deepEqual(toPublicRepository(repo), {
      id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git',
      defaultBranch: 'main', mode: 'read-only', enabled: true,
    })
    assert.deepEqual(toPublicRepository({ ...repo, path: '/private/checkout', exclude: ['*.secret'] }), {
      id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git',
      defaultBranch: 'main', mode: 'read-only', enabled: true,
    })
    assert.deepEqual(await registry.resolvePath('friday', 'src/index.mjs'), join(root, 'src', 'index.mjs'))
    assert.equal(await readFile(await registry.resolvePath('friday', 'README.md'), 'utf8'), 'fixture\n')
    assert.equal(await registry.get('missing'), null)
  })
})

test('refuses traversal, absolute paths, unregistered roots, and excluded secrets', async () => {
  await fixture(async ({ registry }) => {
    for (const path of ['../outside', 'src/../../outside', '/etc/passwd', 'C:\\Windows\\win.ini']) {
      await assert.rejects(registry.resolvePath('friday', path), /outside repository/i)
    }
    await assert.rejects(registry.resolvePath('missing', 'README.md'), /not registered/i)
    for (const path of ['.env.production', '.git', '.git/config', 'src/node_modules/package.json', 'src/private.pem', 'id_ed25519', '.aws/credentials', '.npmrc', 'data']) {
      await assert.rejects(registry.resolvePath('friday', path), /excluded/i)
    }
  })
})

test('rejects symlinks that escape the repository or point to excluded files', async () => {
  await fixture(async ({ dir, root, registry }) => {
    await writeFile(join(dir, 'outside.txt'), 'outside\n')
    await symlink(join(dir, 'outside.txt'), join(root, 'src', 'outside.txt'))
    await symlink(join(root, '.env.production'), join(root, 'src', 'secret-alias'))
    await assert.rejects(registry.resolvePath('friday', 'src/outside.txt'), /outside repository/i)
    await assert.rejects(registry.resolvePath('friday', 'src/secret-alias'), /excluded/i)
  })
})

test('honors repository exclusions and hides remotes with embedded credentials', async () => {
  await fixture(async ({ dir, root, registry }) => {
    await mkdir(join(root, 'private-data'))
    await writeFile(join(root, 'private-data', 'inventory.json'), '{}')
    const config = JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8'))
    config[0].exclude = ['private-data/**']
    config[0].remote = 'https://secret-token@github.com/StMedrano/Friday.git?token=leak'
    await writeFile(join(dir, 'repositories.json'), JSON.stringify(config))
    const refreshed = new LocalRepositoryRegistry({ registryPath: join(dir, 'repositories.json') })
    await assert.rejects(refreshed.resolvePath('friday', 'private-data'), /excluded/i)
    await assert.rejects(refreshed.resolvePath('friday', 'private-data/inventory.json'), /excluded/i)
    assert.deepEqual(toPublicRepository(await refreshed.get('friday')), {
      id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git',
      defaultBranch: 'main', mode: 'read-only', enabled: true,
    })
  })
})

test('fails closed on malformed registries and duplicate repository identifiers', async () => {
  await fixture(async ({ dir, registry }) => {
    assert.deepEqual(await new LocalRepositoryRegistry({ registryPath: join(dir, 'missing.json') }).list(), [])
    await writeFile(join(dir, 'repositories.json'), '{')
    await assert.rejects(registry.list(), SyntaxError)
    await mkdir(join(dir, 'not-a-repo'))
    await writeFile(join(dir, 'repositories.json'), JSON.stringify([
      { id: 'plain-dir', name: 'Plain Directory', path: join(dir, 'not-a-repo'), mode: 'read-only' },
    ]))
    await assert.rejects(new LocalRepositoryRegistry({ registryPath: join(dir, 'repositories.json') }).resolvePath('plain-dir', 'README.md'), /not a Git repository/i)
    await writeFile(join(dir, 'repositories.json'), JSON.stringify([
      { id: 'same', name: 'First', path: dir, mode: 'read-only' },
      { id: 'same', name: 'Second', path: dir, mode: 'read-only' },
    ]))
    await assert.rejects(registry.list(), /duplicate repository id/i)
    await writeFile(join(dir, 'repositories.json'), JSON.stringify([
      { id: 'bad-exclusion', name: 'Bad', path: dir, mode: 'read-only', exclude: [''] },
    ]))
    await assert.rejects(registry.list(), /invalid exclusions/i)
  })
})
