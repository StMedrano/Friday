import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewCommand } from './core.mjs'
import { buildOverview, decorateOverviewWithMonitoring } from './overview.mjs'
import { answerAssistant } from './assistant.mjs'
import { normalizeAssistantHistory, validateAssistantPrompt } from './assistant-input.mjs'
import { toPublicRepository } from './repositories/repository.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'dist')
const SAFE_INCIDENT_ID = /^[A-Za-z0-9_.-]{1,256}$/

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

function safeAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    model: {
      provider: agent.model?.provider || 'unknown',
      model: agent.model?.model || null,
    },
    tools: Array.isArray(agent.tools) ? agent.tools : [],
    permissions: agent.permissions && typeof agent.permissions === 'object' ? agent.permissions : {},
    scope: agent.scope && typeof agent.scope === 'object' ? agent.scope : {},
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 32_768) request.destroy(new Error('Request body too large'))
    })
    request.on('end', () => {
      if (!body) return resolve({})
      try { resolve(JSON.parse(body)) } catch { reject(new Error('Invalid JSON')) }
    })
    request.on('error', reject)
  })
}

function serveStatic(requestPath, response) {
  let decoded
  try { decoded = decodeURIComponent(requestPath) } catch { return false }
  const clean = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  let path = join(publicDir, clean === '/' ? 'index.html' : clean)
  if (!path.startsWith(publicDir)) return false
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(publicDir, 'index.html')
  if (!existsSync(path)) return false
  response.writeHead(200, {
    'content-type': mime[extname(path)] || 'application/octet-stream',
    'cache-control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  })
  createReadStream(path).pipe(response)
  return true
}

function parseIncidentDiagnosticRoute(pathname) {
  const match = String(pathname || '').match(/^\/api\/incidents\/([^/]+)\/(diagnostics|logs)$/)
  if (!match) return null
  let incidentId
  try { incidentId = decodeURIComponent(match[1]) } catch { return { invalid: true } }
  if (!SAFE_INCIDENT_ID.test(incidentId)) return { invalid: true }
  return { invalid: false, incidentId, kind: match[2] }
}

function parseIncidentDiagnosticRerunRoute(pathname) {
  const match = String(pathname || '').match(/^\/api\/incidents\/([^/]+)\/diagnostics\/rerun$/)
  if (!match) return null
  let incidentId
  try { incidentId = decodeURIComponent(match[1]) } catch { return { invalid: true } }
  if (!SAFE_INCIDENT_ID.test(incidentId)) return { invalid: true }
  return { invalid: false, incidentId }
}

async function currentOverview({ config, monitoringRuntime, buildOverviewImpl }) {
  const cached = monitoringRuntime?.getOverview?.()
  if (config.monitoring?.enabled && cached) {
    const { incidents } = monitoringRuntime.getIncidents()
    return decorateOverviewWithMonitoring(cached, {
      incidents,
      summary: monitoringRuntime.getSummary(),
    })
  }
  return buildOverviewImpl(config)
}

export function createFridayServer({
  config,
  monitoringRuntime = null,
  buildOverviewImpl = buildOverview,
  answerAssistantImpl = answerAssistant,
  agentRepository = null,
  repositoryRegistry = null,
  agentOrchestrator = null,
} = {}) {
  if (!config) throw new Error('Friday server config is required')

  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(response, 200, { status: 'ok', service: 'friday', mode: config.mode })
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, { status: 'ok', mode: config.mode, ai: config.ai.enabled, time: new Date().toISOString() })
    }

    if (request.method === 'GET' && url.pathname === '/api/agents') {
      try {
        const agents = agentRepository ? await agentRepository.list() : []
        return json(response, 200, { agents: agents.map(safeAgent) })
      } catch {
        return json(response, 500, { error: 'agents-unavailable' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/repositories') {
      try {
        const repositories = repositoryRegistry ? await repositoryRegistry.list() : []
        return json(response, 200, { repositories: repositories.map(toPublicRepository) })
      } catch {
        return json(response, 500, { error: 'repositories-unavailable' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/overview') {
      try {
        return json(response, 200, await currentOverview({ config, monitoringRuntime, buildOverviewImpl }))
      } catch (error) {
        return json(response, 500, { error: 'overview-failed', detail: error.message })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/incidents') {
      return json(response, 200, monitoringRuntime?.getIncidents?.() || { summary: { active: 0, high: 0, warning: 0, resolved: 0 }, incidents: [] })
    }

    if (request.method === 'GET' && url.pathname === '/api/monitoring/history') {
      return json(response, 200, monitoringRuntime?.getHistory?.() || { events: [] })
    }

    const diagnosticRerunRoute = parseIncidentDiagnosticRerunRoute(url.pathname)
    if (request.method === 'POST' && diagnosticRerunRoute) {
      if (diagnosticRerunRoute.invalid) return json(response, 400, { error: 'invalid-incident-id' })
      const handler = monitoringRuntime?.rerunDiagnostic
      if (typeof handler !== 'function') return json(response, 503, { error: 'diagnostics-unavailable' })
      try {
        const result = await handler.call(monitoringRuntime, diagnosticRerunRoute.incidentId)
        return json(response, result.statusCode, result.body)
      } catch {
        return json(response, 502, { error: 'diagnostics-failed' })
      }
    }

    const diagnosticRoute = parseIncidentDiagnosticRoute(url.pathname)
    if (request.method === 'GET' && diagnosticRoute) {
      if (diagnosticRoute.invalid) return json(response, 400, { error: 'invalid-incident-id' })
      const handler = diagnosticRoute.kind === 'diagnostics'
        ? monitoringRuntime?.getDiagnostic
        : monitoringRuntime?.getIncidentLogs
      if (typeof handler !== 'function') return json(response, 503, { error: 'diagnostics-unavailable' })
      try {
        const result = await handler.call(monitoringRuntime, diagnosticRoute.incidentId)
        return json(response, result.statusCode, result.body)
      } catch {
        return json(response, 502, { error: 'diagnostics-failed' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/commands/preview') {
      try {
        const result = previewCommand(await readBody(request))
        return json(response, result.accepted ? 200 : 400, result)
      } catch (error) {
        return json(response, 400, { accepted: false, mode: 'preview', reason: error.message })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/assistant') {
      try {
        const body = await readBody(request)
        const promptResult = validateAssistantPrompt(body.prompt)
        if (!promptResult.ok) return json(response, 400, promptResult.result)

        const history = normalizeAssistantHistory(body.history)
        const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl })
        const result = await answerAssistantImpl({
          config,
          prompt: promptResult.prompt,
          history,
          overview,
        })
        if (result.available) return json(response, 200, result)
        if (result.error === 'invalid-prompt') return json(response, 400, result)
        return json(response, 503, result)
      } catch {
        return json(response, 502, { available: false, error: 'assistant-failed' })
      }
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (serveStatic(url.pathname, response)) return
    }

    json(response, 404, { error: 'not-found' })
  })
}
