import {lstat, mkdir, readFile, realpath, rename, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve, sep} from 'node:path'
import {LocalRepositoryRegistry, MAX_REGISTRY_BYTES, MODES, parseEntry, publicRemote, REPOSITORY_ID} from './repository.mjs'

// Operator-managed repository registry. Until the first write the mounted
// registry file (FRIDAY_REPOSITORY_REGISTRY_PATH) stays authoritative; the first
// create, edit or delete copies it to the Friday data volume, which then wins.
// New or moved paths must be Git checkouts inside FRIDAY_REPOSITORY_ROOTS, and the
// API can only register read-only repositories; other modes stay a file decision.

export const MAX_REPOSITORIES = 32
const FIELDS = new Set(['id', 'name', 'path', 'remote', 'defaultBranch', 'mode', 'enabled', 'exclude'])
const BRANCH = /^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$/
const CONTROL = /[\u0000-\u001f\u007f]/

const failure = (code, message = code) => { const error = new Error(message); error.code = code; throw error }
const invalid = reason => failure('invalid-repository', reason)
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')

/** Normalise one registry entry, keeping disabled entries so they stay editable. */
export function validateRepositoryEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('repository-object-required')
  if (Object.keys(input).some(key => !FIELDS.has(key))) invalid('unknown-field')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (typeof input.id !== 'string' || !REPOSITORY_ID.test(input.id)) invalid('invalid-repository-id')
  if (!name || name.length > 120 || CONTROL.test(name)) invalid('invalid-repository-name')
  if (typeof input.path !== 'string' || !isAbsolute(input.path) || input.path.length > 1024 || CONTROL.test(input.path)) invalid('invalid-repository-path')
  if (!MODES.has(input.mode ?? 'read-only')) invalid('invalid-repository-mode')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') invalid('invalid-repository-enabled')
  const branch = input.defaultBranch === undefined || input.defaultBranch === '' ? 'main' : input.defaultBranch
  if (typeof branch !== 'string' || !BRANCH.test(branch) || branch.includes('..')) invalid('invalid-repository-branch')
  const remote = input.remote === undefined || input.remote === '' || input.remote === null ? undefined : publicRemote(input.remote)
  if (input.remote && !remote) invalid('invalid-repository-remote')
  const exclude = input.exclude ?? []
  if (!Array.isArray(exclude) || exclude.length > 50 ||
    exclude.some(pattern => typeof pattern !== 'string' || !pattern.trim() || pattern.length > 300 || pattern.startsWith('/') || CONTROL.test(pattern)))
    invalid('invalid-repository-exclude')
  return {
    id: input.id, name, path: resolve(input.path), ...(remote ? {remote} : {}), defaultBranch: branch,
    mode: input.mode ?? 'read-only', enabled: input.enabled ?? true, exclude: exclude.map(pattern => pattern.trim()),
  }
}

/** Entries in the mounted registry file today, including disabled ones; [] when there is none. */
export async function readRegistryEntries(registryPath) {
  let raw
  try { raw = await readFile(registryPath, 'utf8') }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  if (Buffer.byteLength(raw) > MAX_REGISTRY_BYTES) throw new Error('Repository registry exceeds the size limit')
  const entries = JSON.parse(raw)
  if (!Array.isArray(entries)) throw new Error('Repository registry must be a JSON array')
  return entries.flatMap(entry => {
    try { return [validateRepositoryEntry({...entry, path: typeof entry?.path === 'string' ? resolve(entry.path) : entry?.path})] }
    catch (error) { if (entry?.enabled === false) return []; throw error }
  })
}

function validateList(input) {
  if (!input || !Array.isArray(input.repositories) || input.repositories.length > MAX_REPOSITORIES) invalid('invalid-repository-list')
  const repositories = input.repositories.map(validateRepositoryEntry)
  if (new Set(repositories.map(entry => entry.id)).size !== repositories.length) invalid('duplicate-repository')
  return repositories
}

const inside = (root, candidate) => {
  const rel = relative(root, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** A new or moved path must resolve, through any symlinks, to a Git checkout inside an allowed root. */
async function checkPath(path, allowedRoots) {
  if (!allowedRoots.some(root => inside(resolve(root), path))) failure('repository-path-not-allowed')
  let real
  try { real = await realpath(path) } catch { failure('repository-not-git') }
  const roots = await Promise.all(allowedRoots.map(root => realpath(root).catch(() => null)))
  if (!roots.some(root => root && inside(root, real))) failure('repository-path-not-allowed')
  const marker = await lstat(resolve(real, '.git')).catch(() => null)
  if (!marker || marker.isSymbolicLink() || !(marker.isDirectory() || marker.isFile())) failure('repository-not-git')
}

export async function repositorySettingsView({registryPath, allowedRoots = []} = {}, stored = null) {
  return {
    managed: Boolean(stored),
    allowedRoots: [...allowedRoots],
    limit: MAX_REPOSITORIES,
    repositories: (stored || await readRegistryEntries(registryPath)).map(entry => ({...entry, exclude: [...entry.exclude]})),
  }
}

export async function createRepositorySettingsStore({path, allowedRoots = [], fs = {mkdir, readFile, rename, writeFile}} = {}) {
  let current = null
  if (path) {
    try { current = validateList(JSON.parse(await fs.readFile(path, 'utf8'))) }
    catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Friday repository settings could not be loaded; using the registry file')
    }
  }
  // Serialise writes so concurrent requests cannot interleave read-modify-write.
  let queue = Promise.resolve()
  const mutate = (baseline, change) => {
    const run = queue.then(async () => {
      const entries = (current || baseline || []).map(entry => ({...entry}))
      const result = await change(entries)
      if (!path) failure('repository-settings-unavailable')
      const next = validateList({repositories: entries})
      await fs.mkdir(dirname(path), {recursive: true})
      const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(temporary, JSON.stringify({repositories: next}, null, 2) + '\n', {mode: 0o600})
      await fs.rename(temporary, path)
      current = next
      return result
    })
    queue = run.catch(() => {})
    return run
  }
  const indexOf = (entries, id) => {
    const index = entries.findIndex(entry => entry.id === id)
    if (index < 0) failure('repository-not-found')
    return index
  }
  const isObject = input => input && typeof input === 'object' && !Array.isArray(input)

  return {
    get() { return current },
    async create(input, baseline) {
      if (isObject(input) && input.mode !== undefined && input.mode !== 'read-only') invalid('invalid-repository-mode')
      const entry = validateRepositoryEntry(isObject(input) && input.id === undefined && typeof input.name === 'string' ? {...input, id: slug(input.name)} : input)
      return mutate(baseline, async entries => {
        if (entries.some(existing => existing.id === entry.id)) failure('repository-exists')
        if (entries.length >= MAX_REPOSITORIES) failure('repository-limit')
        await checkPath(entry.path, allowedRoots)
        entries.push(entry)
        return entry
      })
    },
    async update(id, input, baseline) {
      if (isObject(input) && input.id !== undefined && input.id !== id) invalid('repository-id-immutable')
      const draft = validateRepositoryEntry(isObject(input) ? {...input, id, mode: input.mode ?? 'read-only'} : input)
      return mutate(baseline, async entries => {
        const index = indexOf(entries, id)
        const existing = entries[index]
        // Keep a mode set in the registry file; the API itself only grants read-only.
        const mode = input.mode === undefined ? existing.mode : draft.mode
        if (mode !== 'read-only' && mode !== existing.mode) invalid('invalid-repository-mode')
        if (draft.path !== existing.path) await checkPath(draft.path, allowedRoots)
        entries[index] = {...draft, mode}
        return entries[index]
      })
    },
    async remove(id, baseline) {
      return mutate(baseline, async entries => { entries.splice(indexOf(entries, id), 1) })
    },
  }
}

/** Repository registry that serves the operator-managed list once one has been saved. */
export class ManagedRepositoryRegistry extends LocalRepositoryRegistry {
  constructor({registryPath, store} = {}) {
    super({registryPath})
    this.store = store
  }

  async list() {
    const stored = this.store?.get()
    if (!stored) return super.list()
    return stored.map(parseEntry).filter(Boolean)
  }
}
