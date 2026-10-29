import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'
import {MAX_ENDPOINT_CHECKS, normalizeEndpointCheck} from './config.mjs'

// Operator-managed HTTP endpoint checks. Until the first write the environment's
// FRIDAY_ENDPOINT_CHECKS_JSON / FRIDAY_ENDPOINT_URLS stay authoritative; the first
// create, edit or delete copies them to the Friday data volume, which then wins.
// Enabling the endpoint adapter itself remains an environment decision.

const failure = (code, message = code) => { const error = new Error(message); error.code = code; throw error }
const invalid = reason => failure('invalid-endpoint-check', reason)
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '')

/** Normalise one check; expectedStatuses null keeps the legacy "any 2xx" rule. */
export function validateEndpointCheck(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('check-object-required')
  const anyStatus = input.expectedStatuses === null
  const check = normalizeEndpointCheck(anyStatus ? {...input, expectedStatuses: [200]} : input)
  if (!check) invalid('invalid-endpoint-check')
  return anyStatus ? {...check, expectedStatuses: null} : check
}

/** Checks the environment defines today, in the shape the endpoint adapter uses. */
export function environmentEndpointChecks(endpoints = {}) {
  if (endpoints.configurationError) return []
  if (endpoints.checks?.length) return endpoints.checks.map(check => ({...check}))
  return (endpoints.urls || []).map((url, index) => {
    let name = url
    try { name = new URL(url).hostname } catch {}
    // Managed names are capped at 80 characters; a long legacy hostname must not block the first write.
    return {id: String(index), name: name.slice(0, 80), site: endpoints.site || 'Site A', url, expectedStatuses: null}
  })
}

/** Effective adapter config: a stored list (even an empty one) replaces the environment's. */
export function applyEndpointChecks(config, stored = null) {
  if (!stored) return config
  return {...config, endpoints: {...config.endpoints, checks: stored.map(check => ({...check})), urls: [], configurationError: null}}
}

export function endpointChecksView(config, stored = null) {
  return {
    managed: Boolean(stored),
    enabled: config.endpoints?.enabled === true,
    limit: MAX_ENDPOINT_CHECKS,
    checks: (stored || environmentEndpointChecks(config.endpoints)).map(check => ({...check})),
  }
}

function validateList(input) {
  if (!input || !Array.isArray(input.checks) || input.checks.length > MAX_ENDPOINT_CHECKS) invalid('invalid-endpoint-list')
  const checks = input.checks.map(validateEndpointCheck)
  if (new Set(checks.map(check => check.id)).size !== checks.length) invalid('duplicate-endpoint-check')
  return checks
}

export async function createEndpointCheckStore({path, fs = {mkdir, readFile, rename, writeFile}} = {}) {
  let current = null
  if (path) {
    try { current = validateList(JSON.parse(await fs.readFile(path, 'utf8'))) }
    catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Friday endpoint checks could not be loaded; using environment checks')
    }
  }
  // Serialise writes so concurrent requests cannot interleave read-modify-write.
  let queue = Promise.resolve()
  const mutate = (baseline, change) => {
    const run = queue.then(async () => {
      const checks = (current || baseline || []).map(check => ({...check}))
      const result = change(checks)
      if (!path) failure('endpoint-checks-unavailable')
      const next = validateList({checks})
      await fs.mkdir(dirname(path), {recursive: true})
      const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(temporary, JSON.stringify({checks: next}, null, 2) + '\n', {mode: 0o600})
      await fs.rename(temporary, path)
      current = next
      return result
    })
    queue = run.catch(() => {})
    return run
  }
  const indexOf = (checks, id) => {
    const index = checks.findIndex(check => check.id === id)
    if (index < 0) failure('endpoint-check-not-found')
    return index
  }

  return {
    get() { return current },
    async create(input, baseline) {
      const draft = input && typeof input === 'object' && !Array.isArray(input) && input.id === undefined && typeof input.name === 'string'
        ? {...input, id: slug(input.name)} : input
      const check = validateEndpointCheck(draft)
      return mutate(baseline, checks => {
        if (checks.some(existing => existing.id === check.id)) failure('endpoint-check-exists')
        if (checks.length >= MAX_ENDPOINT_CHECKS) failure('endpoint-check-limit')
        checks.push(check)
        return check
      })
    },
    async update(id, input, baseline) {
      if (input && typeof input === 'object' && input.id !== undefined && input.id !== id) invalid('endpoint-id-immutable')
      const check = validateEndpointCheck(input && typeof input === 'object' && !Array.isArray(input) ? {...input, id} : input)
      return mutate(baseline, checks => {
        checks[indexOf(checks, id)] = check
        return check
      })
    },
    async remove(id, baseline) {
      return mutate(baseline, checks => { checks.splice(indexOf(checks, id), 1) })
    },
  }
}
