import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { createAccessGate } from './security/access.mjs'

const routes = new Set(['/api/health', '/api/overview', '/api/incidents', '/api/monitoring/history'])
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const MAX_BYTES = 2 * 1024 * 1024

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

// These are envelope checks, not a claim that a cached observation is fresh.
// Reject Promise/undefined/malformed state instead of serializing it as 200 {}.
// Keep authorization and field normalization with their existing upstream owners.
function validSnapshot(route, data) {
  if (!isObject(data)) return false
  if (route === '/api/overview') {
    return ['live', 'mock'].includes(data.mode) &&
      typeof data.generatedAt === 'string' &&
      Number.isFinite(Date.parse(data.generatedAt)) &&
      Array.isArray(data.services)
  }
  if (route === '/api/incidents') {
    return Array.isArray(data.incidents) && isObject(data.summary) &&
      ['active', 'high', 'warning', 'resolved'].every(key =>
        Number.isSafeInteger(data.summary[key]) && data.summary[key] >= 0)
  }
  if (route === '/api/monitoring/history') return Array.isArray(data.events)
  return false
}

// Separate listener: never forwards requests into the UI, repository, AI or
// diagnostic handlers. Reads use the controller's existing monitoring cache.
export function createAutomationServer({ config, monitoringRuntime, accessGateImpl = null,
  logImpl = entry => console.log(JSON.stringify(entry)),
}) {
  const accessGate = accessGateImpl || createAccessGate({
    ...config.automation?.access, identityMode: 'service', operatorEmails: [],
  })
  const server = createServer({ maxHeaderSize: 16384 }, async (request, response) => {
    const started = Date.now()
    const requestId = randomUUID()
    const route = routes.has(request.url) ? request.url : 'unrecognized'
    let subject = null
    response.on('finish', () => {
      // Never log headers, unrecognized URLs, query strings, body or raw errors.
      try { logImpl({ event: 'automation-request', requestId, at: new Date().toISOString(),
        route, method: methods.has(request.method) ? request.method : 'OTHER',
        status: response.statusCode, durationMs: Date.now() - started, subject }) } catch {}
    })
    const reply = (status, body) => {
      let payload = JSON.stringify(body)
      if (Buffer.byteLength(payload) > MAX_BYTES) {
        status = 503; payload = JSON.stringify({ error: 'snapshot-too-large' })
      }
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'x-request-id': requestId, ...(status === 405 ? { allow: 'GET' } : {}) })
      response.end(payload)
    }
    try {
      if (config.automation?.enabled !== true) return reply(503, { error: 'automation-disabled' })
      const auth = await accessGate(request)
      if (auth?.status !== 200 || auth.identity?.kind !== 'service')
        return reply(auth?.status === 503 ? 503 : 403, { error: 'access-denied' })
      subject = createHash('sha256').update(auth.identity.subject).digest('hex')
      if (request.method !== 'GET') return reply(405, { error: 'read-only' })
      if (route === 'unrecognized') return reply(404, { error: 'not-found' })
      if (route === '/api/health') return reply(200, {
        status: 'ok', service: 'friday-automation', mode: config.mode,
        monitoringEnabled: config.monitoring?.enabled === true,
      })
      if (!config.monitoring?.enabled) return reply(503, { error: 'monitoring-disabled' })
      const data = route === '/api/overview' ? monitoringRuntime?.getOverview?.()
        : route === '/api/incidents' ? monitoringRuntime?.getIncidents?.()
          : monitoringRuntime?.getHistory?.()
      if (!validSnapshot(route, data)) return reply(503, { error: 'snapshot-unavailable' })
      return reply(200, data)
    } catch {
      return reply(503, { error: 'automation-unavailable' })
    }
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  server.timeout = 15000
  server.keepAliveTimeout = 5000
  server.maxRequestsPerSocket = 100
  return server
}
