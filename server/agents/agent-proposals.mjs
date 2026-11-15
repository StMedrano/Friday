// "New agent" from Friday. Git stays authoritative for agent definitions
// (agents/*.json, docs/local-agent-platform.md), so Friday never writes the
// runtime registry. Instead an operator fills a form and Friday opens a pull
// request that adds one new agents/<id>.json file. The agent exists only after
// the owner reviews and merges that pull request and syncs the registry.
//
// Off by default (FRIDAY_AGENT_PROPOSALS_ENABLED). The GitHub token is
// server-side only, never logged or echoed, and should be a fine-grained token
// limited to this one repository with Contents and Pull requests write.
// Friday only ever creates a new branch, adds one new file on it and opens a
// pull request; it never pushes to the base branch, edits an existing agent
// file or merges anything.

import { validateAgentSpec } from '../ai/agent-runtime.mjs'

const AGENT_ID = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const NAME_PART = /^[A-Za-z0-9_.-]{1,100}$/
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const TOOL = /^[a-z][a-z0-9_]{1,47}$/
const ACTION = /^[a-z][a-z0-9_]{1,47}$/
const HOST = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const MODES = new Set(['auto', 'approval', 'forbidden'])
// Only reading-style actions may run without approval. Everything else a
// proposal declares must be 'approval' or 'forbidden'.
const AUTO_ALLOWED = /^(inspect|read_|list_|get_|view_|check_)/
const CONTROL = /[\u0000-\u001f\u007f]/
const SECRETISH = /(-----BEGIN [\w ]*PRIVATE KEY-----|authorization\s*[:=]|bearer\s+[\w.-]{6,}|[\w]*(?:api_key|secret|password|token)[\w]*\s*=|sk-[\w-]{8,}|gh[pousr]_[A-Za-z0-9]{20,})/i
const TIMEOUT_MS = 10000
const MAX_REPLY_BYTES = 256 * 1024

const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length >= 1
  && value.length <= max && !CONTROL.test(value) && !SECRETISH.test(value)
const exactKeys = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const list = (value, max, check) => Array.isArray(value) && value.length <= max && value.every(check)
  && new Set(value).size === value.length

const invalid = (field) => { const error = Error('invalid-agent-proposal'); error.code = 'invalid'; error.field = field; throw error }

/**
 * Build a v1.1 agent definition from operator input, or throw with
 * code 'invalid'. Never accepts deployment fields (provider, model, URLs).
 */
export function buildAgentDefinition(input, { profiles = [], existingIds = [] } = {}) {
  if (!exactKeys(input, ['id', 'name', 'description', 'profile', 'tools', 'permissions', 'instructions'], ['hosts', 'enabled'])) invalid('fields')
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!AGENT_ID.test(id)) invalid('id')
  if (existingIds.includes(id)) { const error = Error('agent-exists'); error.code = 'exists'; throw error }
  if (!text(input.name, 80)) invalid('name')
  if (!text(input.description, 500)) invalid('description')
  if (typeof input.profile !== 'string' || !profiles.includes(input.profile)) invalid('profile')
  if (!list(input.tools, 20, (tool) => typeof tool === 'string' && TOOL.test(tool))) invalid('tools')
  const hosts = input.hosts ?? []
  if (!list(hosts, 20, (host) => typeof host === 'string' && HOST.test(host))) invalid('hosts')
  const permissions = input.permissions
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) invalid('permissions')
  const entries = Object.entries(permissions)
  if (entries.length > 40 || entries.some(([action, mode]) => !ACTION.test(action) || !MODES.has(mode)
    || (mode === 'auto' && !AUTO_ALLOWED.test(action)))) invalid('permissions')
  if (!list(input.instructions, 20, (line) => text(line, 300))) invalid('instructions')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') invalid('enabled')

  const definition = {
    version: '1.1',
    id,
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    model: { profile: input.profile },
    scope: { hosts: [...hosts] },
    tools: [...input.tools],
    permissions: Object.fromEntries(entries),
    instructions: [...input.instructions],
  }
  if (!validateAgentSpec(definition).valid) invalid('spec')
  return definition
}

function repositoryParts(value) {
  const parts = String(value || '').split('/')
  return parts.length === 2 && parts.every((part) => NAME_PART.test(part) && part !== '.' && part !== '..')
    ? { owner: parts[0], repo: parts[1] } : null
}

function validApiUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/$/, '') : null
  } catch { return null }
}

class ProposalError extends Error {
  constructor(code) { super(code); this.code = code }
}

/**
 * Opens pull requests that add one agent definition each. `enabled` is false
 * unless the flag, a token, a valid repository and an https API URL are set.
 */
export function createAgentProposer({ enabled = false, token = '', repository = '', baseBranch = 'main', apiUrl = 'https://api.github.com', fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const repo = repositoryParts(repository)
  const api = validApiUrl(apiUrl)
  const ready = enabled === true && typeof token === 'string' && token.length > 0 && Boolean(repo) && Boolean(api)
    && typeof baseBranch === 'string' && BRANCH.test(baseBranch) && typeof fetchImpl === 'function'

  async function call(method, path, body, okStatuses = [200, 201]) {
    let response
    try {
      response = await fetchImpl(`${api}/repos/${repo.owner}/${repo.repo}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept: 'application/vnd.github+json', authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28', 'user-agent': 'friday-agent-proposals',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new ProposalError('github-unavailable') }
    if (response.status === 404 && okStatuses.includes(404)) return { status: 404, body: null }
    if (response.status === 401 || response.status === 403) throw new ProposalError('github-denied')
    if (!okStatuses.includes(response.status)) throw new ProposalError(response.status === 422 ? 'github-rejected' : 'github-unavailable')
    let raw
    try { raw = await response.text() } catch { throw new ProposalError('github-unavailable') }
    if (raw.length > MAX_REPLY_BYTES) throw new ProposalError('github-unavailable')
    try { return { status: response.status, body: raw ? JSON.parse(raw) : null } } catch { throw new ProposalError('github-unavailable') }
  }

  /** Open a pull request adding agents/<id>.json. Returns {number, url, branch, path}. */
  async function propose(definition) {
    if (!ready) throw new ProposalError('disabled')
    if (!validateAgentSpec(definition).valid || !AGENT_ID.test(definition.id)) throw new ProposalError('invalid')
    const path = `agents/${definition.id}.json`
    const base = await call('GET', `/git/ref/heads/${encodeURIComponent(baseBranch)}`)
    const sha = base.body?.object?.sha
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw new ProposalError('github-unavailable')
    // Never replace an existing definition: an agent with this id is already in Git.
    const existing = await call('GET', `/contents/${path}?ref=${encodeURIComponent(baseBranch)}`, undefined, [200, 404])
    if (existing.status !== 404) throw new ProposalError('exists')
    const branch = `friday/agent-${definition.id}-${now().toString(36)}`
    await call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha }, [201])
    const content = Buffer.from(`${JSON.stringify(definition, null, 2)}\n`, 'utf8').toString('base64')
    await call('PUT', `/contents/${path}`, { message: `Add agent ${definition.id} (proposed from Friday)`, content, branch }, [201])
    const pull = await call('POST', '/pulls', {
      title: `Add agent: ${definition.name}`,
      head: branch, base: baseBranch,
      body: [
        `Proposed from Friday's Agents screen by a signed-in operator.`,
        '',
        `Adds \`${path}\` (Agent Spec v1.1). Nothing runs until this pull request is merged and the agent registry is synced from Friday.`,
        '',
        'Review the permissions: only reading-style actions may be `auto`.',
      ].join('\n'),
    }, [201])
    const number = pull.body?.number
    const url = pull.body?.html_url
    if (!Number.isSafeInteger(number) || typeof url !== 'string' || !url.startsWith(`https://github.com/${repo.owner}/${repo.repo}/pull/`))
      throw new ProposalError('github-unavailable')
    return { number, url, branch, path }
  }

  return Object.freeze({ enabled: ready, repository: ready ? `${repo.owner}/${repo.repo}` : null, propose })
}
