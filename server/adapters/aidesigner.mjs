// AIDesigner REST client (https://www.aidesigner.ai/docs/api).
// Server-side only: the API key never reaches the browser, and callers get
// normalized references (session, canvas, editor link), never raw provider
// payloads or generated HTML. Generating a design spends AIDesigner credits,
// so the HTTP layer keeps it operator-only and audited.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[0-9:.]{5,15}(?:Z|[+-]\d{2}:\d{2})$/
const CONTROL = /[\u0000-\u001f\u007f]/
const DELIVERY = new Set(['streamed', 'appended', 'skipped'])
const LIST_MAX_BYTES = 1024 * 1024
const DESIGN_MAX_BYTES = 4 * 1024 * 1024
const LIST_TIMEOUT_MS = 10_000
const SESSION_LIMIT = 20

const STATUS_CODES = {
  400: 'aidesigner-request-rejected',
  401: 'aidesigner-auth-failed',
  403: 'aidesigner-credits-exhausted',
  404: 'aidesigner-session-not-found',
  409: 'aidesigner-canvas-busy',
  429: 'aidesigner-rate-limited',
}

export class AiDesignerError extends Error {
  constructor(code, retryAfter = null) {
    super(code)
    this.code = code
    if (retryAfter !== null) this.retryAfter = retryAfter
  }
}

const unavailable = () => new AiDesignerError('aidesigner-unavailable')

function origin(config) {
  if (config?.enabled !== true) throw unavailable()
  const key = config.apiKey
  if (typeof key !== 'string' || key.length < 8 || /\s/.test(key)) throw unavailable()
  let url
  try { url = new URL(config.baseUrl) } catch { throw unavailable() }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw unavailable()
  return url
}

function retryAfterSeconds(value) {
  const seconds = Number(value)
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600 ? seconds : 60
}

async function readJson(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw unavailable()
  const reader = response.body?.getReader()
  if (!reader) throw unavailable()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw unavailable()
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw unavailable() }
}

function httpsUrl(value, hostAllowed = () => true) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !hostAllowed(url.hostname)) return null
    return url.href
  } catch { return null }
}

const aidesignerHost = host => host === 'aidesigner.ai' || host.endsWith('.aidesigner.ai')
const editorUrl = value => httpsUrl(value, aidesignerHost)
const uuid = value => typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
const timestamp = value => typeof value === 'string' && TIMESTAMP.test(value) ? value : null

function title(value) {
  if (typeof value !== 'string') return 'Untitled'
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 120 && !CONTROL.test(trimmed) ? trimmed : 'Untitled'
}

function normalizeSession(raw) {
  const sessionId = uuid(raw?.session_id)
  if (!sessionId) return null
  return {
    sessionId,
    title: title(raw.title),
    editorUrl: editorUrl(raw.editor_url),
    canvasCount: Number.isSafeInteger(raw.canvas_count) && raw.canvas_count >= 0 ? raw.canvas_count : 0,
    publishedUrl: httpsUrl(raw.published_url),
    updatedAt: timestamp(raw.updated_at),
  }
}

export function createAiDesigner(config, { fetchImpl = fetch } = {}) {
  async function call(path, { method = 'GET', body, timeoutMs, maxBytes }) {
    const base = origin(config)
    let response
    try {
      response = await fetchImpl(new URL(path, base).href, {
        method,
        redirect: 'error',
        headers: {
          authorization: 'Bearer ' + config.apiKey,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch { throw unavailable() }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const code = STATUS_CODES[response.status]
      if (!code) throw unavailable()
      throw new AiDesignerError(code, response.status === 429 ? retryAfterSeconds(response.headers.get('retry-after')) : null)
    }
    return { payload: await readJson(response, maxBytes), headers: response.headers }
  }

  return {
    async listSessions() {
      const { payload } = await call(`/api/v1/sessions?limit=${SESSION_LIMIT}`, { timeoutMs: LIST_TIMEOUT_MS, maxBytes: LIST_MAX_BYTES })
      if (!Array.isArray(payload?.sessions)) throw unavailable()
      return payload.sessions.slice(0, SESSION_LIMIT).map(normalizeSession).filter(Boolean)
    },

    async generateDesign({ prompt, viewport = 'desktop', sessionId = null, idempotencyKey }) {
      if (typeof prompt !== 'string' || !prompt || !IDEMPOTENCY_KEY.test(String(idempotencyKey))) throw new AiDesignerError('aidesigner-request-rejected')
      if (sessionId !== null && !uuid(sessionId)) throw new AiDesignerError('aidesigner-request-rejected')
      const { payload, headers } = await call('/api/v1/generateDesign', {
        method: 'POST',
        timeoutMs: config.timeoutMs,
        maxBytes: DESIGN_MAX_BYTES,
        body: {
          prompt,
          streaming: false,
          session: sessionId || 'new',
          idempotency_key: idempotencyKey,
          viewport: viewport === 'mobile' ? 'mobile' : 'desktop',
          design_mode: 'classic',
        },
      })
      if (payload?.success !== true || typeof payload.content !== 'string') throw unavailable()
      const pick = (field, header) => payload[field] ?? headers.get(header)
      const resolvedSession = uuid(pick('session_id', 'x-aidesigner-session-id'))
      if (!resolvedSession) throw unavailable()
      const rawCanvas = pick('canvas_id', 'x-aidesigner-canvas-id')
      const rawRun = pick('run_id', 'x-aidesigner-run-id')
      return {
        sessionId: resolvedSession,
        canvasId: uuid(rawCanvas),
        runId: uuid(rawRun),
        editorUrl: editorUrl(pick('editor_url', 'x-aidesigner-editor-url')),
        canvasDelivery: DELIVERY.has(payload.canvas_delivery) ? payload.canvas_delivery : null,
        replay: payload.idempotent_replay === true,
        htmlBytes: Buffer.byteLength(payload.content, 'utf8'),
      }
    },
  }
}
