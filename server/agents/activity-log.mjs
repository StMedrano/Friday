import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

// Metadata-only record of agent questions: who (which agent) answered, with
// which model, and whether it worked. Prompts and answers are never stored.
const MAX_LIMIT = 2000
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const OUTCOMES = new Set(['answered', 'unavailable', 'not-found', 'failed'])
const short = (value, max) => typeof value === 'string' && value ? value.slice(0, max) : undefined

function clean(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || entry.id.length > 64
    || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at))
    || typeof entry.agentId !== 'string' || !ID.test(entry.agentId) || !OUTCOMES.has(entry.outcome)
    || !Number.isInteger(entry.durationMs) || entry.durationMs < 0) return null
  const event = { id: entry.id, at: entry.at, agentId: entry.agentId }
  const agentName = short(entry.agentName, 120)
  if (agentName) event.agentName = agentName
  event.outcome = entry.outcome
  for (const key of ['provider', 'model', 'modelProfile', 'reason']) {
    const value = short(entry[key], 120)
    if (value) event[key] = value
  }
  event.durationMs = entry.durationMs
  return event
}

function describe({ agentId, result, error, durationMs }, at) {
  const outcome = error || !result ? 'failed'
    : result.available ? 'answered'
      : result.error === 'agent-unavailable' ? 'not-found' : 'unavailable'
  return clean({
    id: randomUUID(),
    at,
    agentId,
    agentName: result?.agentName,
    outcome,
    provider: outcome === 'answered' ? result.provider : undefined,
    model: outcome === 'answered' ? result.model : undefined,
    modelProfile: outcome === 'answered' ? result.modelProfile : undefined,
    reason: result?.code === 'FRIDAY_AGENT_GROUNDING_INVALID' ? 'grounding-invalid' : undefined,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
  })
}

export async function createAgentActivityLog({ path, limit = 500, now = Date.now } = {}) {
  if (!path) throw new Error('Agent activity path is required')
  const max = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || 500)))
  let events = []
  try {
    const stored = JSON.parse(await readFile(path, 'utf8'))
    events = (Array.isArray(stored?.events) ? stored.events : []).map(clean).filter(Boolean).slice(-max)
  } catch {
    events = []
  }
  let queue = Promise.resolve()

  async function save(snapshot) {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temp, `${JSON.stringify({ schemaVersion: 1, events: snapshot })}\n`, { mode: 0o600 })
    await rename(temp, path)
  }

  return {
    async record(input) {
      const event = describe(input || {}, new Date(now()).toISOString())
      if (!event) return
      events = [...events, event].slice(-max)
      const snapshot = events
      queue = queue.catch(() => {}).then(() => save(snapshot)).catch(() => {})
      await queue
    },
    list() {
      return [...events].reverse().map((event) => ({ ...event }))
    },
  }
}
