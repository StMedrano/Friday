import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

// Private project grants for signed-in people, keyed by the SHA-256 of the
// Cloudflare Access subject so the raw subject is never stored on disk.
const HASH = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MEMORY_SCOPES = new Set(['project', 'group', 'task', 'session'])
const MAX_SUBJECTS = 25
const MAX_ENTRIES = 25

const denied = () => { throw new Error('work-grants-denied') }
const list = (value) => Array.isArray(value) && value.length <= MAX_ENTRIES

function validGrant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('allowedProjectIds') || !keys.includes('allowedMemoryScopes')) return false
  if (!list(value.allowedProjectIds) || !value.allowedProjectIds.every((id) => typeof id === 'string' && ID.test(id))) return false
  if (!list(value.allowedMemoryScopes)) return false
  return value.allowedMemoryScopes.every((scope) => scope && typeof scope === 'object' && !Array.isArray(scope) &&
    Object.keys(scope).length === 2 && MEMORY_SCOPES.has(scope.scope) && typeof scope.ownerId === 'string' && ID.test(scope.ownerId))
}

export async function createWorkGrants({ path, fs = { readFile } } = {}) {
  const grants = new Map()
  if (path) {
    try {
      const parsed = JSON.parse(await fs.readFile(path, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length <= MAX_SUBJECTS) {
        for (const [key, value] of Object.entries(parsed)) {
          if (HASH.test(key) && validGrant(value)) grants.set(key, Object.freeze({
            allowedProjectIds: [...value.allowedProjectIds],
            allowedMemoryScopes: value.allowedMemoryScopes.map((scope) => ({ scope: scope.scope, ownerId: scope.ownerId })),
          }))
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Friday work grants could not be loaded; no private project access is granted')
    }
  }

  return Object.freeze({
    subjects() { return grants.size },
    /** Resolve a signed-in subject to its grants, or deny. Never returns a default grant. */
    async forSubject(subject) {
      if (typeof subject !== 'string' || !subject) denied()
      const grant = grants.get(createHash('sha256').update(subject).digest('hex'))
      if (!grant) denied()
      return { allowedProjectIds: [...grant.allowedProjectIds], allowedMemoryScopes: grant.allowedMemoryScopes.map((scope) => ({ ...scope })) }
    },
  })
}
