import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Approvals queue. Every open monitoring incident that carries a recommended
// action is a pending proposal. An operator approves or denies it; the decision
// is stored here (atomic 0600 file) and audited by the HTTP layer. A decision is
// a record only: nothing is executed (`execution.performed` is always false).
const MAX_LIMIT = 2000
const DECISIONS = new Set(['approved', 'denied'])
const SEVERITIES = new Set(['high', 'warning', 'info'])
const RECENT = 20
export const NO_EXECUTION = Object.freeze({ performed: false, reason: 'Approval is recorded only; automated fixes are not connected.' })

const short = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)

function snapshot(incident) {
  const item = { title: short(incident?.title, 200) || 'Incident' }
  for (const [key, max] of [['detail', 400], ['serviceName', 120], ['host', 120], ['recommendedAction', 400]]) {
    const value = short(incident?.[key], max)
    if (value) item[key] = value
  }
  if (SEVERITIES.has(incident?.severity)) item.severity = incident.severity
  return item
}

function clean(entry) {
  if (!entry || typeof entry !== 'object' || !validId(entry.id) || !validId(entry.incidentId)
    || !DECISIONS.has(entry.decision) || !validTime(entry.decidedAt)) return null
  const record = { id: entry.id, incidentId: entry.incidentId, decision: entry.decision, decidedAt: entry.decidedAt }
  const decidedBy = short(entry.decidedBy, 254)
  if (decidedBy) record.decidedBy = decidedBy
  record.proposal = snapshot(entry.proposal)
  return record
}

/** Pending proposals: open incidents with a recommended action that nobody has decided yet. */
export function pendingProposals(incidents, decisions) {
  const decided = new Set(decisions.map((entry) => entry.incidentId))
  return (Array.isArray(incidents) ? incidents : [])
    .filter((incident) => incident?.status === 'open' && validId(incident.id) && short(incident.recommendedAction, 400) && !decided.has(incident.id))
    .sort((left, right) => String(left.openedAt || '').localeCompare(String(right.openedAt || '')))
    .map((incident) => ({
      id: incident.id,
      incidentId: incident.id,
      state: 'pending',
      openedAt: validTime(incident.openedAt) ? incident.openedAt : undefined,
      ...snapshot(incident),
    }))
}

export function projectApprovals(incidents, decisions) {
  const statusById = new Map((Array.isArray(incidents) ? incidents : []).map((incident) => [incident?.id, incident?.status]))
  return {
    pending: pendingProposals(incidents, decisions),
    recent: decisions.slice(-RECENT).reverse().map((entry) => ({
      id: entry.id,
      incidentId: entry.incidentId,
      state: entry.decision,
      decidedAt: entry.decidedAt,
      ...(entry.decidedBy ? { decidedBy: entry.decidedBy } : {}),
      incidentStatus: statusById.get(entry.incidentId) === 'open' ? 'open' : 'resolved',
      ...entry.proposal,
    })),
    execution: { ...NO_EXECUTION },
  }
}

export async function createApprovalQueue({ path, limit = 500, now = Date.now } = {}) {
  if (!path) throw new Error('Approvals path is required')
  const max = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || 500)))
  let decisions = []
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'))
    decisions = (Array.isArray(stored?.decisions) ? stored.decisions : []).map(clean).filter(Boolean).slice(-max)
  } catch {
    decisions = []
  }
  let queue = Promise.resolve()

  async function save(next) {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, decisions: next })}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

  return Object.freeze({
    list(incidents) {
      return projectApprovals(incidents, decisions)
    },
    /** Record approve/deny for a pending proposal. Serialized so a proposal is decided once. */
    decide({ incidents, incidentId, decision, decidedBy }) {
      const run = async () => {
        if (!DECISIONS.has(decision)) return { status: 400, body: { error: 'invalid-approval-decision' } }
        if (decisions.some((entry) => entry.incidentId === incidentId)) return { status: 409, body: { error: 'approval-already-decided' } }
        const proposal = pendingProposals(incidents, decisions).find((item) => item.incidentId === incidentId)
        if (!proposal) return { status: 404, body: { error: 'approval-not-found' } }
        const record = clean({ id: randomUUID(), incidentId, decision, decidedAt: new Date(now()).toISOString(), decidedBy, proposal })
        const next = [...decisions, record].slice(-max)
        try { await save(next) } catch { return { status: 503, body: { error: 'approvals-unavailable' } } }
        decisions = next
        return {
          status: 200,
          body: {
            approval: projectApprovals(incidents, decisions).recent.find((item) => item.id === record.id),
            execution: { ...NO_EXECUTION },
          },
        }
      }
      const result = queue.then(run, run)
      queue = result.catch(() => {})
      return result
    },
  })
}
