import { open, readdir, stat } from 'node:fs/promises'
import { relative, basename, join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
export const MAX_FILE_BYTES = 128 * 1024
export const MAX_LIST_ENTRIES = 500
export const MAX_SEARCH_RESULTS = 100
export const MAX_GIT_ENTRIES = 50
const GIT_TIMEOUT_MS = 5000
const GIT_MAX_BUFFER = 512 * 1024

function safeRelative(root, fullPath) {
  const value = relative(root, fullPath).replaceAll('\\', '/')
  return value || '.'
}

async function getRepository(registry, repositoryId) {
  const id = String(repositoryId || '').trim()
  if (!id) throw new Error('repositoryId is required')
  const repository = await registry.get(id)
  if (!repository) throw new Error('Repository not registered')
  return repository
}

async function canonicalRoot(registry, repository) {
  return registry.resolvePath(repository, '.')
}

async function readBoundedFile(path) {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Path is not a file')

  const bytesToRead = Math.min(info.size, MAX_FILE_BYTES)
  const buffer = Buffer.alloc(bytesToRead)
  const handle = await open(path, 'r')
  let bytesRead = 0
  try {
    if (bytesToRead > 0) {
      const result = await handle.read(buffer, 0, bytesToRead, 0)
      bytesRead = result.bytesRead
    }
  } finally {
    await handle.close()
  }

  const sample = buffer.subarray(0, bytesRead)
  if (sample.includes(0)) throw new Error('Binary files are not readable')
  return {
    text: sample.toString('utf8'),
    truncated: info.size > MAX_FILE_BYTES,
    bytes: info.size,
  }
}

async function git(root, args) {
  const { stdout } = await execFile('git', args, {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  })
  return stdout
}

async function listEntries(registry, repository, relativePath = '.') {
  const root = await canonicalRoot(registry, repository)
  const target = await registry.resolvePath(repository, relativePath)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error('Path is not a directory')
  const entries = []
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entries.length >= MAX_LIST_ENTRIES) break
    const candidateRelative = safeRelative(root, join(target, entry.name))
    try {
      await registry.resolvePath(repository, candidateRelative)
    } catch {
      continue
    }
    entries.push({ path: candidateRelative, type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' })
  }
  return { path: relativePath || '.', entries, truncated: entries.length >= MAX_LIST_ENTRIES }
}

async function searchRepository(registry, repository, query) {
  const needle = String(query || '').trim()
  if (!needle) throw new Error('query is required')
  const root = await canonicalRoot(registry, repository)
  const results = []

  async function walk(relativeDir = '.') {
    if (results.length >= MAX_SEARCH_RESULTS) return
    const dir = await registry.resolvePath(repository, relativeDir)
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (results.length >= MAX_SEARCH_RESULTS) return
      const relativePath = safeRelative(root, join(dir, entry.name))
      let canonical
      try { canonical = await registry.resolvePath(repository, relativePath) } catch { continue }
      if (entry.isDirectory()) {
        await walk(relativePath)
        continue
      }
      if (!entry.isFile()) continue
      let contents
      try { contents = await readBoundedFile(canonical) } catch { continue }
      const lines = contents.text.split(/\r?\n/)
      for (let index = 0; index < lines.length && results.length < MAX_SEARCH_RESULTS; index += 1) {
        const column = lines[index].toLowerCase().indexOf(needle.toLowerCase())
        if (column === -1) continue
        const start = Math.max(0, column - 80)
        results.push({ path: relativePath, line: index + 1, snippet: lines[index].slice(start, start + 240) })
      }
    }
  }

  await walk('.')
  return { query: needle, results, truncated: results.length >= MAX_SEARCH_RESULTS }
}

export function registerRepositoryTools({ registry, toolRegistry } = {}) {
  if (!registry) throw new TypeError('registry is required')
  if (!toolRegistry) throw new TypeError('toolRegistry is required')

  toolRegistry.register({
    name: 'repo.status', permission: 'inspect_repository', description: 'Read Git status metadata', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      const root = await canonicalRoot(registry, repository)
      const text = await git(root, ['status', '--short', '--branch'])
      return { repositoryId: repository.id, text: text.slice(0, GIT_MAX_BUFFER) }
    },
  })

  toolRegistry.register({
    name: 'repo.list', permission: 'inspect_repository', description: 'List a bounded repository directory', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      return listEntries(registry, repository, args.path || '.')
    },
  })

  toolRegistry.register({
    name: 'repo.read', permission: 'inspect_repository', description: 'Read a bounded UTF-8 repository file', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      const root = await canonicalRoot(registry, repository)
      const path = await registry.resolvePath(repository, args.path)
      const output = await readBoundedFile(path)
      return { path: safeRelative(root, path), ...output }
    },
  })

  toolRegistry.register({
    name: 'repo.search', permission: 'inspect_repository', description: 'Search text inside a registered repository', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      return searchRepository(registry, repository, args.query)
    },
  })

  toolRegistry.register({
    name: 'repo.history', permission: 'inspect_repository', description: 'Read bounded Git commit history metadata', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      const root = await canonicalRoot(registry, repository)
      const stdout = await git(root, ['log', `-${MAX_GIT_ENTRIES}`, '--pretty=format:%H%x1f%an%x1f%aI%x1f%s'])
      const entries = stdout.split('\n').filter(Boolean).map((line) => {
        const [sha, author, date, subject] = line.split('\x1f')
        return { sha, author, date, subject }
      })
      return { entries }
    },
  })

  toolRegistry.register({
    name: 'repo.manifest', permission: 'inspect_repository', description: 'Inspect common dependency manifests', risk: 'observe',
    execute: async ({ args }) => {
      const repository = await getRepository(registry, args.repositoryId)
      const manifests = []
      for (const path of ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml']) {
        try {
          const fullPath = await registry.resolvePath(repository, path)
          const { text, truncated } = await readBoundedFile(fullPath)
          let data = text
          if (basename(path) === 'package.json') data = JSON.parse(text)
          manifests.push({ path, data, truncated })
        } catch {
          // Missing, malformed, or excluded manifests are not exposed.
        }
      }
      return { manifests }
    },
  })

  return toolRegistry
}
