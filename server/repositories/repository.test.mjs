import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
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

test('lists bounded repository files and reads only small in-root files', async () => {
  await fixture(async ({ root, registry }) => {
    assert.deepEqual(await registry.listFiles('friday'), ['README.md', 'src/index.mjs'])
    assert.deepEqual(await registry.listFiles('friday', { path: 'src' }), ['src/index.mjs'])
    assert.equal(await registry.readFile('friday', 'src/index.mjs'), 'export const safe = true\n')
    await writeFile(join(root, 'large.txt'), 'x'.repeat(65_537))
    await assert.rejects(registry.readFile('friday', 'large.txt'), /size limit/i)
    await assert.rejects(registry.readFile('friday', 'src'), /regular file/i)
    await assert.rejects(registry.listFiles('friday', { limit: 201 }), /limit/i)
  })
})

test('bounds repository directory entries across the full traversal', async () => {
  await fixture(async ({ root, registry }) => {
    for (const name of ['a', 'b', 'c']) {
      const parent = join(root, name)
      await mkdir(parent)
      await Promise.all(Array.from({ length: 400 }, (_, index) => mkdir(join(parent, `empty-${index}`))))
    }
    await mkdir(join(root, 'z-last'))
    await writeFile(join(root, 'z-last', 'target.txt'), 'bounded')

    const files = await registry.listFiles('friday')
    assert.ok(files.length < 200)
    assert.ok(!files.includes('z-last/target.txt'))
  })
})

test('repository reads reject binary and malformed UTF-8 without corrupting valid text', async () => {
  await fixture(async ({ root, registry }) => {
    for (const content of [Buffer.from('text\0binary'), Buffer.from([0xc3, 0x28])]) {
      await writeFile(join(root, 'content.txt'), content)
      await assert.rejects(registry.readFile('friday', 'content.txt'), /UTF-8 text/i)
    }
    for (const content of ['', 'Café 日本語 😀\n', '\uFEFFUTF-8 with BOM\n', 'x'.repeat(65_536)]) {
      await writeFile(join(root, 'content.txt'), content)
      assert.equal(await registry.readFile('friday', 'content.txt'), content)
    }
  })
})

test('repository status is read-only and scoped to registered roots', async () => {
  await fixture(async ({ root, registry }) => {
    execFileSync('git', ['-C', root, 'init', '-q'])
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', 'README.md', 'src/index.mjs'])
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'])
    await writeFile(join(root, 'README.md'), 'changed\n')
    const status = await registry.status('friday')
    assert.equal(typeof status.branch, 'string')
    assert.equal(status.dirty, true)
    assert.equal(await registry.status('missing').then(() => false, () => true), true)
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
