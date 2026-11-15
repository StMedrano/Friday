import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Automated fixes, gated behind the approvals queue. A fix runs only when:
//   1. FRIDAY_REMEDIATION_ENABLED is on,
//   2. an operator approved the incident's proposal in the approvals queue,
//   3. the incident is still open,
//   4. the owner's playbook file names a fix for that incident's service,
//   5. an operator presses "Run fix" (never unattended, never from model text),
//   6. it has not run for this approval before, and
//   7. in execute mode, the global automation gate file is armed.
// Friday holds no infrastructure privilege: in execute mode it POSTs the fixed
// playbook action to an owner-run executor. The default mode is dry-run, which
// records what would have run and executes nothing.

export const MODES = Object.freeze(['dry-run', 'execute'])
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const ACTION = /^[a-z][a-z0-9-]{1,40}$/
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const MAX_PLAYBOOKS = 100
const MAX_RUNS = 500
const MAX_REPLY_BYTES = 4096

const text = (value, max) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !CONTROL.test(value)
const exactKeys = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && required.every((key) => Object.hasOwn(value, key))
  && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))

/** Validate the owner's playbook file. Any bad entry rejects the whole file. */
export function parsePlaybooks(value) {
  if (!exactKeys(value, ['schemaVersion', 'playbooks']) || value.schemaVersion !== 1
    || !Array.isArray(value.playbooks) || value.playbooks.length > MAX_PLAYBOOKS) throw Error('invalid-playbooks')
  const ids = new Set()
  return Object.freeze(value.playbooks.map((entry) => {
    if (!exactKeys(entry, ['id', 'serviceId', 'action', 'target', 'description'], ['incidentTypes'])
      || !ID.test(entry.id) || ids.has(entry.id) || !SERVICE.test(entry.serviceId)
      || !ACTION.test(entry.action) || !TARGET.test(entry.target) || !text(entry.description, 200)
      || (entry.incidentTypes !== undefined && (!Array.isArray(entry.incidentTypes) || entry.incidentTypes.length === 0
        || entry.incidentTypes.length > 10 || !entry.incidentTypes.every((type) => ID.test(type))))) throw Error('invalid-playbooks')
    ids.add(entry.id)
    return Object.freeze({ ...entry, ...(entry.incidentTypes ? { incidentTypes: Object.freeze([...entry.incidentTypes]) } : {}) })
  }))
}

export async function loadPlaybooks(path) {
  if (!path) return Object.freeze([])
  try {
    const info = await lstat(path)
    // Owner-written file: refuse symlinks and anything group/world-writable.
    if (!info.isFile() || (info.mode & 0o022) !== 0) throw Error('insecure')
    return parsePlaybooks(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

/** The first playbook for this incident's service (and type, when the playbook lists types). */
export function playbookFor(playbooks, incident) {
  if (!Array.isArray(playbooks) || !incident || typeof incident.serviceId !== 'string') return null
  return playbooks.find((entry) => entry.serviceId === incident.serviceId
    && (!entry.incidentTypes || entry.incidentTypes.includes(incident.type))) || null
}

const publicPlan = (entry) => ({ playbookId: entry.id, action: entry.action, target: entry.target, description: entry.description })

function cleanRun(entry) {
  if (!entry || typeof entry !== 'object' || !text(entry.id, 64) || !text(entry.incidentId, 200) || !text(entry.approvalId, 64)
    || !ID.test(entry.playbookId) || !MODES.includes(entry.mode)
    || !['dry-run', 'pending', 'succeeded', 'failed'].includes(entry.state) || !Number.isFinite(Date.parse(entry.at))) return null
  const run = { id: entry.id, incidentId: entry.incidentId, approvalId: entry.approvalId, playbookId: entry.playbookId,
    mode: entry.mode, state: entry.state, at: entry.at }
  if (text(entry.action, 41)) run.action = entry.action
  if (text(entry.target, 128)) run.target = entry.target
  if (text(entry.requestedBy, 254)) run.requestedBy = entry.requestedBy
  if (text(entry.detail, 120)) run.detail = entry.detail
  return run
}

export async function createRemediationRunner({
  enabled = false, mode = 'dry-run', playbooks = [], executor = {}, automationGate = null,
  path, fetchImpl = globalThis.fetch, timeoutMs = 10000, now = Date.now,
} = {}) {
  const executeMode = mode === 'execute'
  const executorUrl = (() => {
    try {
      const url = new URL(executor.url)
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.href : null
    } catch { return null }
  })()
  const ready = enabled === true && MODES.includes(mode) && Array.isArray(playbooks) && typeof path === 'string' && path.length > 0
    && (!executeMode || (executorUrl !== null && text(executor.token, 4096) && typeof automationGate?.isAllowed === 'function'
      && typeof fetchImpl === 'function'))
  let runs = []
  if (ready) {
    try {
      const stored = JSON.parse(await readFile(path, 'utf8'))
      runs = (Array.isArray(stored?.runs) ? stored.runs : []).map(cleanRun).filter(Boolean).slice(-MAX_RUNS)
    } catch { runs = [] }
  }
  let queue = Promise.resolve()

  async function save(next) {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, runs: next })}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

  async function callExecutor(body) {
    try {
      const response = await fetchImpl(executorUrl, {
        method: 'POST', redirect: 'error',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${executor.token}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      })
      const raw = await response.text()
      if (Buffer.byteLength(raw, 'utf8') > MAX_REPLY_BYTES) return { ok: false, detail: 'executor-reply-too-large' }
      const reply = JSON.parse(raw)
      if (!response.ok || reply?.ok !== true) return { ok: false, detail: `executor-${response.ok ? 'refused' : 'http-' + response.status}` }
      return { ok: true }
    } catch {
      return { ok: false, detail: 'executor-unavailable' }
    }
  }

  return Object.freeze({
    enabled: ready,
    mode: ready ? mode : null,
    /** What "Run fix" would do for this incident, and whether it already ran for this approval. */
    describe(incident, approvalId) {
      if (!ready) return null
      const entry = playbookFor(playbooks, incident)
      if (!entry) return null
      // A dry run never counts against a real execution, and vice versa.
      const last = runs.findLast((run) => run.approvalId === approvalId && run.mode === mode)
      return { ...publicPlan(entry), mode, ...(last ? { run: { state: last.state, at: last.at, mode: last.mode } } : {}) }
    },
    recent() {
      return runs.slice(-20).reverse()
    },
    /**
     * Run the approved fix once. `approval` is the stored decision from the
     * approvals queue; `incidents` the current monitoring incidents.
     */
    run({ incidents, incidentId, approval, requestedBy }) {
      const attempt = async () => {
        if (!ready) return { status: 404, body: { error: 'remediation-disabled' } }
        if (!approval || approval.incidentId !== incidentId || approval.decision !== 'approved')
          return { status: 409, body: { error: 'fix-not-approved' } }
        const incident = (Array.isArray(incidents) ? incidents : []).find((item) => item?.id === incidentId)
        if (!incident || incident.status !== 'open') return { status: 409, body: { error: 'incident-not-open' } }
        const entry = playbookFor(playbooks, incident)
        if (!entry) return { status: 404, body: { error: 'no-fix-for-service' } }
        // Once per approval and mode. A 'pending' execution (sent, outcome not
        // recorded) also blocks: it may have run, so it is never re-sent.
        if (runs.some((run) => run.approvalId === approval.id && run.mode === mode && run.state !== 'failed'))
          return { status: 409, body: { error: 'fix-already-run' } }
        // The global automation kill switch is checked immediately before execution.
        if (executeMode && automationGate.isAllowed() !== true) return { status: 423, body: { error: 'automation-gate-closed' } }
        const record = { id: randomUUID(), incidentId, approvalId: approval.id, playbookId: entry.id,
          action: entry.action, target: entry.target, mode, at: new Date(now()).toISOString(),
          ...(text(requestedBy, 254) ? { requestedBy } : {}) }
        if (!executeMode) {
          const stored = cleanRun({ ...record, state: 'dry-run' })
          const next = [...runs, stored].slice(-MAX_RUNS)
          try { await save(next) } catch { return { status: 503, body: { error: 'remediation-unavailable' } } }
          runs = next
          return { status: 200, body: { fix: { ...publicPlan(entry), mode, state: stored.state, at: stored.at },
            execution: { performed: false, reason: 'Dry run: recorded what would run; nothing was executed.' } } }
        }
        // Durably claim the execution BEFORE dispatch, so a crash or a failed
        // final write can never let the same approval be sent twice.
        const pending = cleanRun({ ...record, state: 'pending' })
        const claimed = [...runs, pending].slice(-MAX_RUNS)
        try { await save(claimed) } catch { return { status: 503, body: { error: 'remediation-unavailable' } } }
        runs = claimed
        const outcome = await callExecutor({ requestId: record.id, playbookId: entry.id, action: entry.action,
          target: entry.target, incidentId })
        const stored = cleanRun({ ...record, state: outcome.ok ? 'succeeded' : 'failed', ...(outcome.detail ? { detail: outcome.detail } : {}) })
        const next = runs.map((run) => run.id === record.id ? stored : run)
        let recorded = true
        // If the outcome cannot be written, the run stays 'pending' (blocks a resend).
        try { await save(next); runs = next } catch { recorded = false }
        const execution = { performed: true, succeeded: outcome.ok, ...(outcome.detail ? { reason: outcome.detail } : {}), ...(recorded ? {} : { recorded: false }) }
        return { status: outcome.ok ? 200 : 502, body: { fix: { ...publicPlan(entry), mode, state: recorded ? stored.state : 'pending', at: stored.at }, execution } }
      }
      const result = queue.then(attempt, attempt)
      queue = result.catch(() => {})
      return result
    },
  })
}
