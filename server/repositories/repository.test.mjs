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

test('repository text reads enforce the 64 KiB limit in bytes for multibyte UTF-8', async () => {
  await fixture(async ({ root, registry }) => {
    const content = '😀'.repeat(16_384)
    assert.equal(Buffer.byteLength(content), 65_536)
    await writeFile(join(root, 'content.txt'), content)
    assert.equal(await registry.readFile('friday', 'content.txt'), content)

    await writeFile(join(root, 'content.txt'), `${content}x`)
    await assert.rejects(registry.readFile('friday', 'content.txt'), /size limit/i)
  })
})

test('repository status reports the branch before the first commit', async () => {
  await fixture(async ({ root, registry }) => {
    execFileSync('git', ['-C', root, 'init', '-q', '--initial-branch=feature/new-checkout'])
    assert.deepEqual(await registry.status('friday'), { branch: 'feature/new-checkout', dirty: false })
    execFileSync('git', ['-C', root, 'add', 'README.md'])
    assert.deepEqual(await registry.status('friday'), { branch: 'feature/new-checkout', dirty: true })
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

test('repository status disables configured fsmonitor hooks', async () => {
  await fixture(async ({ root, registry }) => {
    const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args])
    git('init', '-q', '--initial-branch=main')
    git('add', 'README.md')
    git('commit', '-qm', 'fixture')
    const hook = join(root, '.git', 'fsmonitor-fixture')
    const sentinel = join(root, '.git', 'fsmonitor-called')
    await writeFile(hook, '#!/bin/sh\nprintf called > .git/fsmonitor-called\nprintf "token\\0"\n', { mode: 0o755 })
    git('config', 'core.fsmonitor', hook)

    // Prove that Git can execute the fixture before checking Friday's boundary.
    git('-c', `core.fsmonitor=${hook}`, 'status', '--porcelain=v1', '--untracked-files=no')
    assert.equal(await readFile(sentinel, 'utf8'), 'called')
    await rm(sentinel)

    assert.deepEqual(await registry.status('friday'), { branch: 'main', dirty: false })
    await writeFile(join(root, 'README.md'), 'changed\n')
    assert.deepEqual(await registry.status('friday'), { branch: 'main', dirty: true })
    await assert.rejects(readFile(sentinel), { code: 'ENOENT' })
  })
})

test('linked worktrees keep file reads and status scoped to the registered checkout', async () => {
  await fixture(async ({ dir, root, registry }) => {
    const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args])
    git('init', '-q', '--initial-branch=main')
    git('add', 'README.md', 'src/index.mjs')
    git('commit', '-qm', 'fixture')
    const linked = join(dir, 'linked')
    git('worktree', 'add', '-q', '-b', 'feature/linked', linked)
    assert.match(await readFile(join(linked, '.git'), 'utf8'), /^gitdir: /)
    const registryPath = join(dir, 'repositories.json')
    const entries = JSON.parse(await readFile(registryPath, 'utf8'))
    await writeFile(registryPath, JSON.stringify([
      ...entries, { ...entries[0], id: 'linked', path: linked },
    ]))

    assert.deepEqual(await registry.status('linked'), { branch: 'feature/linked', dirty: false })
    await writeFile(join(linked, 'README.md'), 'linked checkout\n')
    assert.deepEqual(await registry.status('linked'), { branch: 'feature/linked', dirty: true })
    assert.deepEqual(await registry.status('friday'), { branch: 'main', dirty: false })
    assert.equal(await registry.readFile('linked', 'README.md'), 'linked checkout\n')
    assert.equal(await registry.readFile('friday', 'README.md'), 'fixture\n')
    assert.deepEqual(await registry.listFiles('linked'), ['README.md', 'src/index.mjs'])
    await assert.rejects(registry.readFile('linked', '.git'), /excluded/i)
    await assert.rejects(registry.readFile('linked', '../checkout/README.md'), /outside repository/i)
    await symlink(join(root, 'README.md'), join(linked, 'main-readme'))
    await assert.rejects(registry.readFile('linked', 'main-readme'), /outside repository/i)
  })
})

test('repository status keeps upstream metadata separate from branch and working-tree state', async () => {
  await fixture(async ({ root, registry }) => {
    const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { encoding: 'utf8' }).trim()
    git('init', '-q', '--initial-branch=feature/status')
    git('add', 'README.md')
    git('commit', '-qm', 'fixture')
    const base = git('rev-parse', 'HEAD')
    git('remote', 'add', 'origin', root)
    git('update-ref', 'refs/remotes/origin/main', base)
    git('branch', '--set-upstream-to=origin/main')
    const clean = { branch: 'feature/status', dirty: false }
    assert.deepEqual(await registry.status('friday'), clean)

    git('commit', '--allow-empty', '-qm', 'ahead')
    assert.deepEqual(await registry.status('friday'), clean)
    git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'))
    git('reset', '--soft', base)
    assert.deepEqual(await registry.status('friday'), clean)
    git('commit', '--allow-empty', '-qm', 'diverged')
    assert.deepEqual(await registry.status('friday'), clean)
    git('update-ref', '-d', 'refs/remotes/origin/main')
    assert.deepEqual(await registry.status('friday'), clean)

    git('checkout', '--detach', '-q')
    assert.deepEqual(await registry.status('friday'), { branch: 'HEAD (no branch)', dirty: false })
    await writeFile(join(root, 'README.md'), 'changed while detached\n')
    assert.deepEqual(await registry.status('friday'), { branch: 'HEAD (no branch)', dirty: true })
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

test('repository exclusions treat question marks as single-character path wildcards', async () => {
  await fixture(async ({ dir, root, registry }) => {
    const config = JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8'))
    config[0].exclude = ['private?.txt', 'src?index.mjs']
    await writeFile(join(dir, 'repositories.json'), JSON.stringify(config))
    for (const name of ['private1.txt', 'private.txt', 'private12.txt']) {
      await writeFile(join(root, name), 'fixture\n')
    }

    await assert.rejects(registry.readFile('friday', 'private1.txt'), /excluded/i)
    assert.equal(await registry.readFile('friday', 'private.txt'), 'fixture\n')
    assert.equal(await registry.readFile('friday', 'private12.txt'), 'fixture\n')
    assert.deepEqual(await registry.listFiles('friday'), [
      'README.md', 'private.txt', 'private12.txt', 'src/index.mjs',
    ])
  })
})

test('repository globstar directory exclusions match zero or more directories', async () => {
  await fixture(async ({ dir, root, registry }) => {
    const config = JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8'))
    config[0].exclude = ['**/inventory.json', 'src/**/private.txt']
    await writeFile(join(dir, 'repositories.json'), JSON.stringify(config))
    for (const path of ['inventory.json', 'src/inventory.json', 'src/nested/inventory.json', 'src/private.txt', 'src/nested/private.txt']) {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), 'fixture\n')
      await assert.rejects(registry.readFile('friday', path), /excluded/i)
    }
    await writeFile(join(root, 'private.txt'), 'allowed\n')
    assert.equal(await registry.readFile('friday', 'private.txt'), 'allowed\n')
    assert.deepEqual(await registry.listFiles('friday'), ['README.md', 'private.txt', 'src/index.mjs'])
  })
})

test('repository globstar exclusions cover paths containing line terminators', async () => {
  await fixture(async ({ dir, root, registry }) => {
    const config = JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8'))
    config[0].exclude = ['**/inventory.json']
    await writeFile(join(dir, 'repositories.json'), JSON.stringify(config))
    for (const separator of ['\n', '\r', '\u2028', '\u2029']) {
      const directory = `reports${separator}archive`
      await mkdir(join(root, directory))
      await writeFile(join(root, directory, 'inventory.json'), '{}')
      await assert.rejects(registry.readFile('friday', `${directory}/inventory.json`), /excluded/i)
    }
    assert.deepEqual(await registry.listFiles('friday'), ['README.md', 'src/index.mjs'])
  })
})

test('requires string repository identifiers without coercing JSON values', async () => {
  await fixture(async ({ dir, root, registry }) => {
    for (const id of [123, true, ['friday'], null, {}]) {
      await writeFile(join(dir, 'repositories.json'), JSON.stringify([
        { id, name: 'Friday', path: root, mode: 'read-only' },
      ]))
      await assert.rejects(registry.list(), /entry 0 is invalid/i)
    }
    await writeFile(join(dir, 'repositories.json'), JSON.stringify([
      { id: '123', name: 'Friday', path: root, mode: 'read-only' },
    ]))
    assert.equal((await registry.get('123')).id, '123')
    assert.equal(await registry.readFile('123', 'README.md'), 'fixture\n')
  })
})

test('requires boolean enabled flags while preserving omitted and disabled entries', async () => {
  await fixture(async ({ dir, root, registry }) => {
    const entry = { id: 'friday', name: 'Friday', path: root, mode: 'read-only' }
    for (const enabled of ['false', 'true', 0, 1, null, [], {}]) {
      await writeFile(join(dir, 'repositories.json'), JSON.stringify([{ ...entry, enabled }]))
      await assert.rejects(registry.list(), /entry 0 is invalid/i)
    }
    for (const enabled of [undefined, true]) {
      await writeFile(join(dir, 'repositories.json'), JSON.stringify([{ ...entry, enabled }]))
      assert.equal((await registry.get('friday')).enabled, true)
    }
    await writeFile(join(dir, 'repositories.json'), JSON.stringify([{ ...entry, enabled: false }]))
    assert.deepEqual(await registry.list(), [])
    await assert.rejects(registry.readFile('friday', 'README.md'), /not registered/i)
  })
})

test('accepts registries at the byte limit and rejects one byte above it', async () => {
  await fixture(async ({ dir, registry }) => {
    const registryPath = join(dir, 'repositories.json')
    const entries = JSON.parse(await readFile(registryPath, 'utf8'))
    entries.push({ enabled: false, description: 'é'.repeat(256 * 1024) })
    const raw = JSON.stringify(entries)
    const atLimit = raw + ' '.repeat(1024 * 1024 - Buffer.byteLength(raw))
    assert.equal(Buffer.byteLength(atLimit), 1024 * 1024)
    assert.ok(atLimit.length < 1024 * 1024)

    await writeFile(registryPath, atLimit)
    assert.deepEqual((await registry.list()).map(({ id }) => id), ['friday'])

    await writeFile(registryPath, atLimit + ' ')
    await assert.rejects(registry.list(), /registry exceeds the size limit/i)
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
