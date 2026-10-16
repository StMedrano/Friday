import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

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
}
