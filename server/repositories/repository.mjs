import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'

export const DEFAULT_EXCLUDES = [
  '.env', '.env.*', '.git/**', '**/*.pem', '**/*.key', '**/id_rsa', '**/id_ed25519',
  'node_modules/**', 'dist/**', 'build/**', '.next/**',
]

const MODES = new Set(['read-only', 'development', 'pr-enabled'])
const ID = /^[A-Za-z0-9_.-]{1,128}$/

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function normalizeRelative(pathname) {
  return String(pathname || '.').replaceAll('\\', '/').replace(/^\.\//, '')
}

function isExcluded(pathname, extra = []) {
  const clean = normalizeRelative(pathname)
  return [...DEFAULT_EXCLUDES, ...(Array.isArray(extra) ? extra : [])]
    .some((pattern) => globToRegExp(pattern).test(clean))
}

function normalizeDefinition(value) {
  if (!value || typeof value !== 'object') return null
  if (!ID.test(String(value.id || ''))) return null
  if (!String(value.name || '').trim() || !String(value.path || '').trim()) return null
  if (!MODES.has(value.mode)) return null
  if (value.enabled === false) return null
  return {
    id: String(value.id),
    name: String(value.name).trim(),
    path: resolve(String(value.path)),
    remote: value.remote ? String(value.remote) : null,
    defaultBranch: String(value.defaultBranch || 'main'),
    mode: value.mode,
    enabled: true,
    exclude: Array.isArray(value.exclude) ? value.exclude.map(String) : [],
  }
}

export function toPublicRepository(repository) {
  if (!repository) return null
  return {
    id: repository.id,
    name: repository.name,
    ...(repository.remote ? { remote: repository.remote } : {}),
    defaultBranch: repository.defaultBranch,
    mode: repository.mode,
    enabled: repository.enabled !== false,
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
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Repository registry must be a JSON array')
    return parsed.map(normalizeDefinition).filter(Boolean)
  }

  async get(id) {
    return (await this.list()).find((repository) => repository.id === id) || null
  }

  async resolvePath(repository, relativePath = '.') {
    if (!repository?.path) throw new Error('Repository definition is required')
    const requested = normalizeRelative(relativePath)
    if (requested.startsWith('../') || requested === '..' || requested.startsWith('/')) {
      throw new Error('Path is outside repository')
    }
    if (isExcluded(requested, repository.exclude)) throw new Error('Path is excluded')

    const root = await realpath(repository.path)
    const candidate = await realpath(resolve(root, requested))
    const rel = relative(root, candidate)
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(candidate) === resolve(root, '..')) {
      throw new Error('Path is outside repository')
    }
    const canonicalRelative = normalizeRelative(relative(root, candidate) || '.')
    if (isExcluded(canonicalRelative, repository.exclude)) throw new Error('Path is excluded')
    return candidate
  }
}
