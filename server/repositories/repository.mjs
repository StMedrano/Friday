import { lstat, open, opendir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isUtf8 } from 'node:buffer'

const execFileAsync = promisify(execFile)
const MAX_READ_BYTES = 64 * 1024
const MAX_LIST_LIMIT = 200
const MAX_DIRECTORY_ENTRIES = 1000

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MODES = new Set(['read-only', 'development', 'pr-enabled'])
const EXCLUDED_NAMES = new Set([
  '.git', '.aws', '.ssh', 'node_modules', 'dist', 'build', '.next', 'coverage', 'data', 'secrets', 'credentials', 'private-keys',
  '.envrc', '.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials.json', 'credentials.yaml', 'credentials.yml', 'credentials.toml',
  'service-account.json', 'client-secret.json', 'private_key.json',
])
const PRIVATE_KEYS = new Set(['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa'])
const MAX_REGISTRY_BYTES = 1024 * 1024

function publicRemote(value) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return /^git@[\w.-]+:[\w./-]+\.git$/.test(value) ? value : undefined
  }
}

export function toPublicRepository(repository) {
  if (!repository) return null
  const remote = publicRemote(repository.remote)
  return {
    id: repository.id,
    name: repository.name,
    ...(remote ? { remote } : {}),
    defaultBranch: repository.defaultBranch,
    mode: repository.mode,
    enabled: true,
  }
}

function matchesPattern(pattern, pathname) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`).test(pathname)
}

function isExcluded(pathname, extra = []) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || EXCLUDED_NAMES.has(part) || /^\.env(?:\.|$)/i.test(part)
    || /\.(?:pem|key|p12|pfx|keystore|secret|token)$/i.test(part) || PRIVATE_KEYS.has(part.toLowerCase()))) return true

  const patterns = Array.isArray(extra) ? extra.filter((pattern) => typeof pattern === 'string') : []
  return patterns.some((pattern) => {
    const clean = pattern.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
    return parts.some((_, index) => matchesPattern(clean, parts.slice(0, index + 1).join('/')))
      || matchesPattern(clean, pathname)
      || clean.endsWith('/**') && pathname === clean.slice(0, -3)
  })
}

function parseEntry(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Repository registry entry ${index} is invalid`)
  }
  if (value.enabled === false) return null
  if (!ID.test(String(value.id || '')) || typeof value.name !== 'string' || !value.name.trim()
    || value.name.length > 120 || typeof value.path !== 'string' || !value.path.trim()
    || !MODES.has(value.mode)) {
    throw new Error(`Repository registry entry ${index} is invalid`)
  }
  if (value.exclude !== undefined && (!Array.isArray(value.exclude)
    || value.exclude.some((pattern) => typeof pattern !== 'string' || !pattern.trim() || pattern.length > 300 || pattern.startsWith('/')))) {
    throw new Error(`Repository registry entry ${index} has invalid exclusions`)
  }
  return {
    id: value.id,
    name: value.name.trim(),
    path: resolve(value.path),
    remote: publicRemote(value.remote),
    defaultBranch: typeof value.defaultBranch === 'string' && value.defaultBranch.trim() ? value.defaultBranch.trim() : 'main',
    mode: value.mode,
    enabled: true,
    exclude: value.exclude || [],
  }
}

export class LocalRepositoryRegistry {
  constructor({ registryPath = './repositories.json' } = {}) {
    this.registryPath = registryPath
  }

  async list() {
    let raw
    try {
      raw = await readFile(this.registryPath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    if (Buffer.byteLength(raw) > MAX_REGISTRY_BYTES) throw new Error('Repository registry exceeds the size limit')
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) throw new Error('Repository registry must be a JSON array')
    const repositories = entries.map(parseEntry).filter(Boolean)
    const ids = new Set()
    for (const repository of repositories) {
      if (ids.has(repository.id)) throw new Error(`Duplicate repository ID: ${repository.id}`)
      ids.add(repository.id)
    }
    return repositories
  }

  async get(id) {
    return (await this.list()).find((repository) => repository.id === id) || null
  }

  async resolvePath(id, requested = '.') {
    const repository = await this.get(id)
    if (!repository) throw new Error('Repository is not registered or enabled')
    if (typeof requested !== 'string' || requested.includes('\0')) throw new Error('Path is outside repository')
    const pathname = requested.replaceAll('\\', '/') || '.'
    if (pathname.startsWith('/') || /^[A-Za-z]:\//.test(pathname)
      || pathname.split('/').includes('..')) throw new Error('Path is outside repository')
    const clean = pathname.replace(/^\.\//, '').replace(/\/$/, '') || '.'
    if (isExcluded(clean, repository.exclude)) throw new Error('Path is excluded')

    const root = await realpath(repository.path)
    if (!(await stat(root)).isDirectory()) throw new Error('Registered root is not a directory')
    const marker = await lstat(resolve(root, '.git')).catch(() => null)
    if (!marker || marker.isSymbolicLink() || !(marker.isDirectory() || marker.isFile())) {
      throw new Error('Registered root is not a Git repository')
    }
    const candidate = await realpath(resolve(root, clean))
    const rel = relative(root, candidate)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path is outside repository')
    const canonical = rel.replaceAll(sep, '/') || '.'
    if (isExcluded(canonical, repository.exclude)) throw new Error('Path is excluded')
    return candidate
  }

  async listFiles(id, { path = '.', limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) throw new Error('File list limit is invalid')
    const root = await this.resolvePath(id, '.')
    const start = path === '.' ? root : await this.resolvePath(id, path)
    if (!(await stat(start)).isDirectory()) throw new Error('Path is not a directory')
    const files = []
    const visited = new Set()
    let entriesSeen = 0
    const walk = async (directory, depth) => {
      if (depth > 20 || files.length >= limit || entriesSeen >= MAX_DIRECTORY_ENTRIES) return
      const canonical = await realpath(directory)
      if (visited.has(canonical)) return
      visited.add(canonical)
      const handle = await opendir(directory)
      const entries = []
      for await (const entry of handle) {
        if (entries.length >= MAX_DIRECTORY_ENTRIES) break
        entries.push(entry)
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      entries.length = Math.min(entries.length, MAX_DIRECTORY_ENTRIES - entriesSeen)
      entriesSeen += entries.length
      for (const entry of entries) {
        if (files.length >= limit) break
        const candidate = resolve(directory, entry.name)
        let safePath
        try { safePath = await this.resolvePath(id, relative(root, candidate)) }
        catch { continue }
        const info = await stat(safePath)
        if (info.isDirectory()) await walk(safePath, depth + 1)
        else if (info.isFile()) files.push(relative(root, safePath).split(sep).join('/'))
      }
    }
    await walk(start, 0)
    return files.sort()
  }

  async readFile(id, requested) {
    const pathname = await this.resolvePath(id, requested)
    const info = await stat(pathname)
    if (!info.isFile()) throw new Error('Path is not a regular file')
    if (info.size > MAX_READ_BYTES) throw new Error('File exceeds the read size limit')
    const handle = await open(pathname, 'r')
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      if (bytesRead > MAX_READ_BYTES) throw new Error('File exceeds the read size limit')
      const content = buffer.subarray(0, bytesRead)
      if (content.includes(0) || !isUtf8(content)) throw new Error('File is not UTF-8 text')
      return content.toString('utf8')
    } finally { await handle.close() }
  }

  async status(id) {
    const repository = await this.get(id)
    if (!repository) throw new Error('Repository is not registered or enabled')
    const root = await this.resolvePath(id, '.')
    const { stdout } = await execFileAsync('git', ['-C', root, 'status', '--porcelain=v1', '--branch', '--untracked-files=no'], {
      encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024,
      env: {
        ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false',
      },
    })
    const [header, ...changes] = stdout.trimEnd().split('\n')
    return { branch: header?.startsWith('## ') ? header.slice(3).split('...')[0] : 'unknown', dirty: changes.length > 0 }
  }
}
