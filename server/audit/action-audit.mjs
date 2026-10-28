import {constants} from 'node:fs'
import {createHash, randomUUID} from 'node:crypto'
import {lstat, mkdir, open} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'

// Durable, append-only operator action audit. Separate from monitoring
// history: one hash-chained JSON line per lifecycle event, fsynced before
// the caller continues. No update, delete, rotate or repair API exists.
const ACTIONS = new Set(['agents.registry.sync', 'incidents.diagnostics.rerun', 'settings.sites.update',
  'settings.endpoints.create', 'settings.endpoints.update', 'settings.endpoints.delete'])
const PHASES = new Set(['requested', 'succeeded', 'failed', 'denied'])
const ACTOR_KINDS = new Set(['human', 'service', 'unauthenticated'])
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const HEX64 = /^[a-f0-9]{64}$/
const CONTROL = /[\u0000-\u001f\u007f]/
const GENESIS = '0'.repeat(64)
const INPUT_FIELDS = new Set(['action', 'phase', 'actor', 'target', 'detail', 'requestId'])
const RECORD_FIELDS = ['seq', 'requestId', 'at', 'action', 'phase', 'actor', 'target', 'detail', 'prev', 'hash']
export const AUDIT_ACTIONS = Object.freeze([...ACTIONS])
export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024

const rejected = () => { throw Error('audit-rejected') }
const unavailable = () => { throw Error('audit-unavailable') }
const sha256 = value => createHash('sha256').update(value).digest('hex')
const text = (value, max) => value === null || (typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL.test(value))

/** Project a verified Access identity into the stored actor shape. */
export function auditActor(identity) {
  if (!identity || typeof identity.subject !== 'string' || !identity.subject) return {kind: 'unauthenticated', id: null, label: null}
  const kind = identity.kind === 'service' ? 'service' : 'human'
  const label = kind === 'service' ? identity.subject : (typeof identity.email === 'string' && identity.email ? identity.email.toLowerCase().trim() : null)
  return {kind, id: sha256('friday-actor:' + identity.subject), label: label && text(label, 254) ? label : null}
}

function validActor(actor) {
  if (!actor || typeof actor !== 'object' || Object.keys(actor).length !== 3 || !ACTOR_KINDS.has(actor.kind)) return false
  if (actor.kind === 'unauthenticated') return actor.id === null && actor.label === null
  return HEX64.test(actor.id) && text(actor.label, 254)
}

function body(record) {
  // Fixed key order makes the hash input canonical.
  return JSON.stringify({seq: record.seq, requestId: record.requestId, at: record.at, action: record.action, phase: record.phase,
    actor: {kind: record.actor.kind, id: record.actor.id, label: record.actor.label},
    target: record.target, detail: record.detail, prev: record.prev})
}

function validRecord(record, seq, prev) {
  return record && typeof record === 'object' && Object.keys(record).length === RECORD_FIELDS.length &&
    RECORD_FIELDS.every(key => Object.hasOwn(record, key)) && record.seq === seq && UUID.test(record.requestId) &&
    typeof record.at === 'string' && !Number.isNaN(Date.parse(record.at)) && ACTIONS.has(record.action) &&
    PHASES.has(record.phase) && validActor(record.actor) && text(record.target, 256) && text(record.detail, 240) &&
    record.prev === prev && record.hash === sha256(body(record))
}

export async function createActionAudit({directory, maxBytes = DEFAULT_MAX_BYTES, now = Date.now} = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) unavailable()
  const path = join(directory, 'actions.jsonl')
  try { await mkdir(directory, {recursive: true, mode: 0o700}) } catch { unavailable() }

  async function checkDirectory() {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) unavailable()
  }

  // Reads and fully verifies the log. Returns null records on any break.
  async function load() {
    await checkDirectory()
    let file
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW) }
    catch (error) { if (error.code === 'ENOENT') return {records: [], bytes: 0, intact: true}; unavailable() }
    try {
      const info = await file.stat()
      if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) unavailable()
      if (info.size > maxBytes) return {records: null, bytes: info.size, intact: false}
      const raw = await file.readFile('utf8')
      if (raw && !raw.endsWith('\n')) return {records: null, bytes: info.size, intact: false}
      const records = []
      let prev = GENESIS
      for (const line of raw ? raw.slice(0, -1).split('\n') : []) {
        let record
        try { record = JSON.parse(line) } catch { return {records: null, bytes: info.size, intact: false} }
        if (!validRecord(record, records.length + 1, prev)) return {records: null, bytes: info.size, intact: false}
        records.push(record)
        prev = record.hash
      }
      return {records, bytes: Buffer.byteLength(raw), intact: true}
    } finally { await file.close() }
  }

  const initial = await load()
  let intact = initial.intact
  let seq = intact ? initial.records.length : 0
  let last = intact && seq ? initial.records[seq - 1].hash : GENESIS
  let bytes = initial.bytes
  if (intact && bytes === 0) {
    // Create the file eagerly so its private mode is fixed before any reader.
    try { await (await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_APPEND, 0o600)).close() }
    catch { unavailable() }
  }
  let queue = Promise.resolve()
  // Reads and writes share one queue so a read never observes a half-applied append.
  function serialized(task) {
    const result = queue.then(task)
    queue = result.catch(() => {})
    return result
  }
  // The on-disk log must be exactly the chain this process last wrote or verified.
  const matchesHead = loaded => loaded.intact && loaded.records.length === seq &&
    (seq === 0 ? loaded.bytes === 0 : loaded.records[seq - 1].hash === last) && loaded.bytes === bytes

  async function append(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) rejected()
    const {action, phase, actor, target = null, detail = null, requestId = randomUUID()} = input
    if (!ACTIONS.has(action) || !PHASES.has(phase) || !validActor(actor) || !text(target, 256) || !text(detail, 240) ||
      typeof requestId !== 'string' || !UUID.test(requestId)) rejected()
    if (!intact) unavailable()
    // Re-verify the whole chain and its head before every append: an in-place
    // edit of equal length or a truncation must never be extended.
    if (!matchesHead(await load())) { intact = false; unavailable() }
    const record = {seq: seq + 1, requestId, at: new Date(now()).toISOString(), action, phase,
      actor: {kind: actor.kind, id: actor.id, label: actor.label}, target, detail, prev: last}
    record.hash = sha256(body(record))
    const line = JSON.stringify(record) + '\n'
    const size = Buffer.byteLength(line)
    if (bytes + size > maxBytes) throw Error('audit-full')
    let file
    try { file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW) } catch { unavailable() }
    try {
      const info = await file.stat()
      // Another writer or an edit since our last append breaks the chain.
      if (!info.isFile() || info.size !== bytes || (info.mode & 0o077) !== 0) { intact = false; unavailable() }
      await file.writeFile(line)
      await file.sync()
    } finally { await file.close() }
    seq = record.seq; last = record.hash; bytes += size
    return record
  }

  return Object.freeze({
    record(input) {
      return serialized(() => append(input))
    },
    async list({limit = 50, before = null, action = null} = {}) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        (before !== null && (!Number.isSafeInteger(before) || before < 1)) || (action !== null && !ACTIONS.has(action))) rejected()
      return serialized(() => listVerified({limit, before, action}))
    },
    status() {
      return {integrity: intact ? 'verified' : 'broken', events: seq, bytes, maxBytes}
    },
  })

  async function listVerified({limit, before, action}) {
    const loaded = await load()
    if (!intact || !matchesHead(loaded)) { intact = false; return {integrity: 'broken', events: [], nextBefore: null} }
    const events = []
    for (let i = loaded.records.length - 1; i >= 0 && events.length <= limit; i--) {
      const record = loaded.records[i]
      if (before !== null && record.seq >= before) continue
      if (action !== null && record.action !== action) continue
      events.push(record)
    }
    const more = events.length > limit
    const page = events.slice(0, limit)
    return {integrity: 'verified', events: page, nextBefore: more ? page[page.length - 1].seq : null}
  }
}
