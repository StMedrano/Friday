import https from 'node:https'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Homelab changes from Friday: power actions on Proxmox guests the owner lists.
// A change happens only when all of these hold:
//   1. FRIDAY_HOMELAB_ACTIONS_ENABLED is on and the owner's catalog file is valid,
//   2. the catalog lists that guest and that operation (start, shutdown, reboot),
//   3. an operator asked for a dry-run preview, which read the guest's live state,
//   4. the same operator approved that preview within five minutes by typing the
//      guest's name (each preview approves one run, once),
//   5. the guest is still in the state the operation needs, and
//   6. in execute mode, the automation gate file on the host is armed.
// Nothing is ever chosen by model text. The Proxmox token is a separate,
// owner-scoped token (VM.Audit + VM.PowerMgmt on the listed guests only), so
// Proxmox itself refuses anything outside that scope. The default mode is
// dry-run: it records what would run and changes nothing.

export const MODES = Object.freeze(['dry-run', 'execute'])
export const OPERATIONS = Object.freeze(['start', 'shutdown', 'reboot'])
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const NODE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const UPID = /^UPID:[A-Za-z0-9.:@_-]{1,240}$/
const MAX_ACTIONS = 50
const MAX_RUNS = 500
const MAX_PLANS = 100
export const PLAN_TTL_MS = 5 * 60 * 1000
const STATES = ['dry-run', 'pending', 'submitted', 'failed']

// What each operation needs, and what it does, in plain words.
const NEEDS = Object.freeze({ start: 'stopped', shutdown: 'running', reboot: 'running' })
const VERB = Object.freeze({
  start: 'start it',
  shutdown: 'ask it to shut down cleanly (like pressing the power button)',
  reboot: 'ask it to reboot cleanly',
})

const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !CONTROL.test(value)
const exactKeys = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))

/** Validate the owner's catalog. Any bad entry rejects the whole file. */
export function parseHomelabCatalog(value) {
  if (!exactKeys(value, ['schemaVersion', 'actions']) || value.schemaVersion !== 1
    || !Array.isArray(value.actions) || value.actions.length > MAX_ACTIONS) throw Error('invalid-homelab-catalog')
  const ids = new Set()
  const guests = new Set()
  return Object.freeze(value.actions.map((entry) => {
    if (!exactKeys(entry, ['id', 'name', 'node', 'guestType', 'vmid', 'operations'], ['description'])
      || !ID.test(entry.id) || ids.has(entry.id) || !text(entry.name, 80) || !NODE.test(entry.node)
      || !['qemu', 'lxc'].includes(entry.guestType) || !Number.isSafeInteger(entry.vmid) || entry.vmid < 100 || entry.vmid > 999999999
      || !Array.isArray(entry.operations) || entry.operations.length === 0 || entry.operations.length > OPERATIONS.length
      || new Set(entry.operations).size !== entry.operations.length || !entry.operations.every((op) => OPERATIONS.includes(op))
      || (entry.description !== undefined && !text(entry.description, 200))) throw Error('invalid-homelab-catalog')
    const guest = `${entry.node}/${entry.vmid}`
    if (guests.has(guest)) throw Error('invalid-homelab-catalog')
    ids.add(entry.id)
    guests.add(guest)
    return Object.freeze({ ...entry, operations: Object.freeze(OPERATIONS.filter((op) => entry.operations.includes(op))) })
  }))
}

export async function loadHomelabCatalog(path) {
  if (!path) return null
  try {
    const info = await lstat(path)
    // Owner-written file: refuse symlinks and anything group/world-writable.
    if (!info.isFile() || (info.mode & 0o022) !== 0) throw Error('insecure')
    return parseHomelabCatalog(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

function requestProxmox(config, method, path) {
  return new Promise((resolve, reject) => {
    const base = new URL(config.baseUrl)
    const request = https.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || 8006,
      path: `${base.pathname.replace(/\/$/, '')}/api2/json${path}`,
      method,
      rejectUnauthorized: config.rejectUnauthorized !== false,
      headers: { Authorization: `PVEAPIToken=${config.tokenId}=${config.tokenSecret}`, accept: 'application/json' },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
        if (body.length > 65536) request.destroy(Error('Proxmox reply too large'))
      })
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) return reject(Error(`proxmox-http-${response.statusCode}`))
        try { resolve(JSON.parse(body).data ?? null) } catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.setTimeout(8000, () => request.destroy(Error('Proxmox API timeout')))
    request.end()
  })
}

/**
 * Power-only Proxmox client. Paths are built from the validated catalog entry,
 * never from request input, and the only POSTs are status/{start,shutdown,reboot}.
 */
export function createProxmoxPowerClient({ baseUrl, tokenId, tokenSecret, rejectUnauthorized = true, requestImpl = requestProxmox } = {}) {
  const config = { baseUrl, tokenId, tokenSecret, rejectUnauthorized }
  const ready = (() => {
    try { return new URL(baseUrl).protocol === 'https:' && text(tokenId, 200) && text(tokenSecret, 200) } catch { return false }
  })()
  const guestPath = (guest) => `/nodes/${encodeURIComponent(guest.node)}/${guest.guestType}/${guest.vmid}/status`
  return Object.freeze({
    ready,
    async status(guest) {
      const data = await requestImpl(config, 'GET', `${guestPath(guest)}/current`)
      const status = typeof data?.status === 'string' ? data.status : 'unknown'
      return { status: ['running', 'stopped', 'paused'].includes(status) ? status : 'unknown' }
    },
    async act(guest, operation) {
      if (!OPERATIONS.includes(operation)) throw Error('operation-not-allowed')
      const upid = await requestImpl(config, 'POST', `${guestPath(guest)}/${operation}`)
      return { upid: typeof upid === 'string' && UPID.test(upid) ? upid : null }
    },
  })
}

function cleanRun(entry) {
  if (!entry || typeof entry !== 'object' || !UUID.test(entry.id) || !ID.test(entry.actionId) || !OPERATIONS.includes(entry.operation)
    || !MODES.includes(entry.mode) || !STATES.includes(entry.state) || !Number.isFinite(Date.parse(entry.at))) return null
  const run = { id: entry.id, actionId: entry.actionId, operation: entry.operation, mode: entry.mode, state: entry.state, at: entry.at }
  if (text(entry.name, 80)) run.name = entry.name
  if (text(entry.before, 20)) run.before = entry.before
  if (text(entry.requestedBy, 254)) run.requestedBy = entry.requestedBy
  if (typeof entry.upid === 'string' && UPID.test(entry.upid)) run.upid = entry.upid
  if (text(entry.detail, 120)) run.detail = entry.detail
  return run
}

const publicAction = (entry) => ({ id: entry.id, name: entry.name, guestType: entry.guestType, vmid: entry.vmid, node: entry.node,
  operations: [...entry.operations], ...(entry.description ? { description: entry.description } : {}) })

export async function createHomelabActions({
  enabled = false, mode = 'dry-run', catalog = [], client = null, automationGate = null, path,
  now = Date.now, planTtlMs = PLAN_TTL_MS,
} = {}) {
  const executeMode = mode === 'execute'
  const ready = enabled === true && MODES.includes(mode) && Array.isArray(catalog) && client?.ready === true
    && typeof client.status === 'function' && typeof client.act === 'function'
    && typeof path === 'string' && path.length > 0 && (!executeMode || typeof automationGate?.isAllowed === 'function')
  let runs = []
  if (ready) {
    try {
      const stored = JSON.parse(await readFile(path, 'utf8'))
      runs = (Array.isArray(stored?.runs) ? stored.runs : []).map(cleanRun).filter(Boolean).slice(-MAX_RUNS)
    } catch { runs = [] }
  }
  // Previews live in memory only: a restart forgets them, which only means asking again.
  const plans = new Map()
  let queue = Promise.resolve()
  const serial = (attempt) => {
    const result = queue.then(attempt, attempt)
    queue = result.catch(() => {})
    return result
  }

  async function save(next) {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, runs: next })}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

  async function readStatus(entry) {
    try { return (await client.status(entry)).status } catch { return 'unknown' }
  }

  function prunePlans(at) {
    for (const [id, plan] of plans) if (plan.expiresAt <= at || plan.used) plans.delete(id)
    while (plans.size >= MAX_PLANS) plans.delete(plans.keys().next().value)
  }

  return Object.freeze({
    enabled: ready,
    mode: ready ? mode : null,
    /** The owner's catalog with each guest's live state, plus recent runs. */
    async list() {
      if (!ready) return null
      const actions = await Promise.all(catalog.map(async (entry) => ({ ...publicAction(entry), status: await readStatus(entry) })))
      return { mode, actions, recent: runs.slice(-20).reverse() }
    },
    /** Dry run: read the guest's live state and say what the operation would do. Changes nothing. */
    preview({ actionId, operation, requestedBy }) {
      return serial(async () => {
        if (!ready) return { status: 404, body: { error: 'homelab-actions-disabled' } }
        const entry = catalog.find((item) => item.id === actionId)
        if (!entry) return { status: 404, body: { error: 'homelab-action-not-found' } }
        if (!entry.operations.includes(operation)) return { status: 403, body: { error: 'homelab-operation-not-allowed' } }
        const status = await readStatus(entry)
        const at = now()
        const label = `${entry.guestType === 'lxc' ? 'CT' : 'VM'} ${entry.vmid} ${entry.name}`
        const allowed = status === NEEDS[operation]
        const summary = allowed
          ? `${label} is ${status}. Approving will ${VERB[operation]}.`
          : `${label} is ${status}; ${operation} needs it ${NEEDS[operation]}, so there is nothing to do.`
        const plan = { id: randomUUID(), actionId: entry.id, operation, before: status, allowed, requestedBy: text(requestedBy, 254) ? requestedBy : null,
          expiresAt: at + planTtlMs, used: false }
        if (allowed) {
          prunePlans(at)
          plans.set(plan.id, plan)
        }
        return { status: 200, body: { preview: {
          ...(allowed ? { planId: plan.id } : {}), actionId: entry.id, name: entry.name, operation, mode, currentStatus: status,
          allowed, summary, confirmText: entry.name, expiresAt: new Date(plan.expiresAt).toISOString(),
        }, execution: { performed: false, reason: 'Preview only: nothing was changed.' } } }
      })
    },
    /** Approve one preview by typing the guest's name. Runs once; dry-run mode records only. */
    run({ planId, confirm, requestedBy }) {
      return serial(async () => {
        if (!ready) return { status: 404, body: { error: 'homelab-actions-disabled' } }
        const at = now()
        const plan = typeof planId === 'string' ? plans.get(planId) : undefined
        if (!plan || plan.used || plan.expiresAt <= at) return { status: 409, body: { error: 'homelab-preview-expired' } }
        // A preview approves one run by the operator who asked for it.
        if (plan.requestedBy !== (text(requestedBy, 254) ? requestedBy : null)) return { status: 403, body: { error: 'homelab-preview-not-yours' } }
        const entry = catalog.find((item) => item.id === plan.actionId)
        if (!entry || !entry.operations.includes(plan.operation)) return { status: 409, body: { error: 'homelab-preview-expired' } }
        if (confirm !== entry.name) return { status: 400, body: { error: 'homelab-confirm-mismatch' } }
        plan.used = true
        plans.delete(plan.id)
        // The guest may have changed since the preview; re-check right before acting.
        const before = await readStatus(entry)
        if (before !== NEEDS[plan.operation]) return { status: 409, body: { error: 'homelab-state-changed', currentStatus: before } }
        // The global automation kill switch is checked immediately before execution.
        if (executeMode && automationGate.isAllowed() !== true) return { status: 423, body: { error: 'automation-gate-closed' } }
        const record = { id: randomUUID(), actionId: entry.id, name: entry.name, operation: plan.operation, mode, before,
          at: new Date(at).toISOString(), ...(plan.requestedBy ? { requestedBy: plan.requestedBy } : {}) }
        const action = { actionId: entry.id, name: entry.name, operation: plan.operation, mode }
        if (!executeMode) {
          const stored = cleanRun({ ...record, state: 'dry-run' })
          const next = [...runs, stored].slice(-MAX_RUNS)
          try { await save(next) } catch { return { status: 503, body: { error: 'homelab-actions-unavailable' } } }
          runs = next
          return { status: 200, body: { run: { ...action, state: 'dry-run', at: stored.at },
            execution: { performed: false, reason: 'Dry run: recorded what would run; nothing was changed.' } } }
        }
        // Durably claim the run BEFORE dispatch so it can never be sent twice.
        const pending = cleanRun({ ...record, state: 'pending' })
        const claimed = [...runs, pending].slice(-MAX_RUNS)
        try { await save(claimed) } catch { return { status: 503, body: { error: 'homelab-actions-unavailable' } } }
        runs = claimed
        let outcome
        try { outcome = { ok: true, ...(await client.act(entry, plan.operation)) } }
        catch (error) { outcome = { ok: false, detail: /^proxmox-http-\d{3}$/.test(error?.message) ? error.message : 'proxmox-unavailable' } }
        const stored = cleanRun({ ...record, state: outcome.ok ? 'submitted' : 'failed',
          ...(outcome.upid ? { upid: outcome.upid } : {}), ...(outcome.detail ? { detail: outcome.detail } : {}) })
        const next = runs.map((run) => run.id === record.id ? stored : run)
        let recorded = true
        try { await save(next); runs = next } catch { recorded = false }
        const execution = { performed: true, succeeded: outcome.ok, ...(outcome.detail ? { reason: outcome.detail } : {}), ...(recorded ? {} : { recorded: false }) }
        return { status: outcome.ok ? 200 : 502, body: { run: { ...action, state: recorded ? stored.state : 'pending', at: stored.at }, execution } }
      })
    },
  })
}
