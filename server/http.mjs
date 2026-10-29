import { createServer } from 'node:http'
import { toPublicRepository } from './repositories/repository.mjs'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewCommand } from './core.mjs'
import { buildOverview, decorateOverviewWithMonitoring } from './overview.mjs'
import { answerAssistant } from './assistant.mjs'
import { normalizeAssistantHistory, validateAssistantPrompt } from './assistant-input.mjs'
import { validateAgentId, validateAgentPrompt, validateRegistrySyncBody } from './agents/input.mjs'
import { createAccessGate } from './security/access.mjs'
import { handleWorkReadHttp } from './work/http-reads.mjs'
import { auditActor } from './audit/action-audit.mjs'
import { buildSettingsView } from './settings.mjs'
import { applySiteSettings, siteSettingsView } from './site-settings.mjs'
import { normalizeSubscription, vapidKeys } from './notifications/web-push.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'dist')
const SAFE_INCIDENT_ID = /^[A-Za-z0-9_.-]{1,256}$/
const SAFE_REPOSITORY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const NO_AGENT_EXECUTION = { performed: false, reason: 'Phase 1 agents are advisory only.' }

function matchedRoutingProvenance(route = {}) {
  return {
    matched: true,
    method: route.routing || 'none',
    confidence: Number.isFinite(route.confidence) ? route.confidence : 0,
    reason: route.reason || 'Registered agent matched.',
  }
}

function localAgentUnavailable(route = {}) {
  return {
    available: false,
    mode: 'local-agent',
    provider: 'ollama',
    error: 'local-agent-unavailable',
    ...(route.agentId ? { agentId: route.agentId } : {}),
    ...(route.agentName ? { agentName: route.agentName } : {}),
    reason: 'Local agent inference unavailable.',
    routing: matchedRoutingProvenance(route),
    execution: { ...NO_AGENT_EXECUTION },
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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
    'cache-control': path.endsWith('index.html') || path.endsWith('/sw.js') || path.endsWith('.webmanifest') ? 'no-cache' : 'public, max-age=3600',
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

function parseAgentDetailRoute(pathname) {
  const match = String(pathname || '').match(/^\/api\/agents\/([^/]+)$/)
  if (!match) return null
  let agentId
  try { agentId = decodeURIComponent(match[1]) } catch { return { invalid: true } }
  const validated = validateAgentId(agentId)
  return validated.ok ? { invalid: false, agentId: validated.id } : { invalid: true }
}

function parseAgentAskRoute(pathname) {
  const match = String(pathname || '').match(/^\/api\/agents\/([^/]+)\/ask$/)
  if (!match) return null
  let agentId
  try { agentId = decodeURIComponent(match[1]) } catch { return { invalid: true } }
  const validated = validateAgentId(agentId)
  return validated.ok ? { invalid: false, agentId: validated.id } : { invalid: true }
}

function parseRepositoryToolRoute(pathname) {
  const match = String(pathname || '').match(/^\/api\/repositories\/([^/]+)\/(status|files|file)$/)
  if (!match) return null
  let id
  try { id = decodeURIComponent(match[1]) } catch { return { invalid: true } }
  return SAFE_REPOSITORY_ID.test(id) ? { id, tool: match[2] } : { invalid: true }
}

const AUDIT_DETAIL = /^[a-z0-9-]{1,64}$/

// Writes `requested` before running and the outcome after. When an audit
// store is configured but cannot persist the request, the action never runs.
async function runAudited({ actionAudit, identity, action, target = null }, run) {
  if (!actionAudit) return run()
  const actor = auditActor(identity)
  let requested
  try { requested = await actionAudit.record({ action, phase: 'requested', actor, target }) }
  catch { return { status: 503, body: { error: 'audit-unavailable' } } }
  let result
  try { result = await run() }
  catch (error) {
    await actionAudit.record({ action, phase: 'failed', actor, target, requestId: requested.requestId, detail: 'exception' }).catch(() => {})
    throw error
  }
  const failed = result.status >= 400
  const code = failed && typeof result.body?.error === 'string' && AUDIT_DETAIL.test(result.body.error) ? result.body.error : null
  try {
    await actionAudit.record({ action, phase: failed ? 'failed' : 'succeeded', actor, target, requestId: requested.requestId, detail: code })
  } catch {
    console.warn('Friday action audit could not record an outcome for ' + action)
  }
  return result
}

function parseAuditQuery(searchParams) {
  const integer = (name) => {
    const raw = searchParams.get(name)
    if (raw === null) return null
    return /^[0-9]{1,9}$/.test(raw) ? Number(raw) : NaN
  }
  const limit = integer('limit')
  const before = integer('before')
  return { limit: limit ?? 50, before, action: searchParams.get('action') }
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
  agentRegistryService = null,
  agentService = null,
  repositoryRegistry = null,
  buildOverviewImpl = buildOverview,
  answerAssistantImpl = answerAssistant,
  accessGateImpl = null,
  workReadBridge = null,
  actionAudit = null,
  siteSettings = null,
  pushSubscriptions = null,
} = {}) {
  if (!config) throw new Error('Friday server config is required')
  const buildEffectiveOverview = (effectiveConfig) =>
    buildOverviewImpl(siteSettings ? applySiteSettings(effectiveConfig, siteSettings.get()) : effectiveConfig)
  const securityRequired = config.access?.enabled === true ||
    (config.mode === 'live' && config.access?.enabled !== false)
  const accessGate = securityRequired ? (accessGateImpl || createAccessGate(config.access)) : null

  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(response, 200, { status: 'ok', service: 'friday', mode: config.mode })
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(response, 200, { status: 'ok', mode: config.mode, ai: config.ai.enabled, time: new Date().toISOString() })
    }

    // Protect every operational API before any service method is reached.
    // Health probes alone are public; browser UI assets are static.
    let identity = null
    if (accessGate && url.pathname.startsWith('/api/')) {
      const registrySync = request.method === 'POST' && url.pathname === '/api/agents/registry/sync'
      const siteSettingsWrite = request.method === 'PUT' && url.pathname === '/api/settings/sites'
      const pushWrite = (request.method === 'POST' || request.method === 'DELETE') && url.pathname === '/api/notifications/web-push'
      const operatorOnly = registrySync || siteSettingsWrite || url.pathname === '/api/audit/events'
      let verdict
      try { verdict = await accessGate(request, operatorOnly) }
      catch { verdict = {status:503,error:'access-verification-unavailable'} }
      if (verdict?.status !== 200) {
        const denied = verdict?.status === 503
        return json(response, denied ? 503 : 403, {error:denied?'access-verification-unavailable':'access-denied'})
      }
      identity = verdict.identity || null
      // Do not allow browser-origin cross-site requests to use a verified session
      // for operational POST/PUT handlers. Registry sync and site settings additionally require JSON.
      if ((request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE') && request.headers['sec-fetch-site'] === 'cross-site')
        return json(response, 403, {error:'access-denied'})
      if ((registrySync || siteSettingsWrite || pushWrite) && !/^application\/json(?:\s*;|\s*$)/i.test(String(request.headers['content-type']||'')))
        return json(response, 415, {error:'json-required'})
    }

    // Opt-in read-only transport; server/index.mjs does not inject a bridge.
    // The bridge independently verifies the signed Access human JWT and
    // resolves private grants on every request; no browser-supplied roles.
    const workRead = await handleWorkReadHttp({request,url,bridge:workReadBridge})
    if (workRead) return json(response, workRead.status, workRead.body)

    if (request.method === 'GET' && url.pathname === '/api/overview') {
      try {
        return json(response, 200, await currentOverview({ config, monitoringRuntime, buildOverviewImpl: buildEffectiveOverview }))
      } catch (error) {
        return json(response, 500, { error: 'overview-failed', detail: error.message })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/settings') {
      return json(response, 200, buildSettingsView(config, { actionAudit }))
    }

    // Any Access-verified user may subscribe the browser they are signed in on.
    if (url.pathname === '/api/notifications/web-push' && ['GET', 'POST', 'DELETE'].includes(request.method)) {
      const keys = vapidKeys(config.notifications?.webPush)
      if (request.method === 'GET') return json(response, 200, { enabled: Boolean(keys && pushSubscriptions), publicKey: keys && pushSubscriptions ? keys.publicKey : null })
      if (!keys || !pushSubscriptions) return json(response, 503, { error: 'web-push-unavailable' })
      let body
      try { body = await readBody(request) } catch { return json(response, 400, { error: 'invalid-json' }) }
      const subscription = normalizeSubscription(body)
      if (!subscription) return json(response, 400, { error: 'invalid-subscription' })
      try {
        if (request.method === 'POST') await pushSubscriptions.add(subscription)
        else await pushSubscriptions.remove(subscription.id)
      } catch { return json(response, 503, { error: 'web-push-unavailable' }) }
      return json(response, 200, { subscribed: request.method === 'POST' })
    }

    if (url.pathname === '/api/settings/sites' && (request.method === 'GET' || request.method === 'PUT')) {
      if (!siteSettings) return json(response, 503, { error: 'site-settings-unavailable' })
      if (request.method === 'GET') return json(response, 200, siteSettingsView(config, siteSettings.get()))
      const result = await runAudited({ actionAudit, identity, action: 'settings.sites.update' }, async () => {
        let body
        try { body = await readBody(request) } catch { return { status: 400, body: { error: 'invalid-json' } } }
        try { await siteSettings.save(body) } catch (error) {
          return error?.code === 'invalid-site-settings'
            ? { status: 400, body: { error: error.message } }
            : { status: 503, body: { error: 'site-settings-unavailable' } }
        }
        return { status: 200, body: siteSettingsView(config, siteSettings.get()) }
      })
      return json(response, result.status, result.body)
    }

    if (request.method === 'GET' && url.pathname === '/api/incidents') {
      return json(response, 200, monitoringRuntime?.getIncidents?.() || { summary: { active: 0, high: 0, warning: 0, resolved: 0 }, incidents: [] })
    }

    if (request.method === 'GET' && url.pathname === '/api/monitoring/history') {
      return json(response, 200, monitoringRuntime?.getHistory?.() || { events: [] })
    }

    if (request.method === 'GET' && url.pathname === '/api/audit/events') {
      if (!actionAudit) return json(response, 503, { error: 'audit-not-enabled' })
      try {
        return json(response, 200, await actionAudit.list(parseAuditQuery(url.searchParams)))
      } catch (error) {
        return error?.message === 'audit-rejected'
          ? json(response, 400, { error: 'invalid-audit-query' })
          : json(response, 503, { error: 'audit-unavailable' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/agents') {
      if (!agentRegistryService) return json(response, 503, { error: 'agent-registry-unavailable' })
      try {
        return json(response, 200, await agentRegistryService.list())
      } catch {
        return json(response, 503, { error: 'agent-registry-unavailable' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/repositories') {
      if (!repositoryRegistry) return json(response, 503, { error: 'repository-registry-unavailable' })
      try {
        const repositories = await repositoryRegistry.list()
        return json(response, 200, repositories.map(toPublicRepository))
      } catch {
        return json(response, 503, { error: 'repository-registry-unavailable' })
      }
    }

    const repositoryToolRoute = parseRepositoryToolRoute(url.pathname)
    if (request.method === 'GET' && repositoryToolRoute) {
      if (repositoryToolRoute.invalid) return json(response, 400, { error: 'invalid-repository-id' })
      if (!repositoryRegistry) return json(response, 503, { error: 'repository-registry-unavailable' })
      try {
        if (repositoryToolRoute.tool === 'status') return json(response, 200, await repositoryRegistry.status(repositoryToolRoute.id))
        if (repositoryToolRoute.tool === 'files') {
          const rawLimit = url.searchParams.get('limit')
          if (rawLimit !== null && !/^\d+$/.test(rawLimit)) throw new Error('File list limit is invalid')
          const limit = rawLimit === null ? 100 : Number(rawLimit)
          return json(response, 200, await repositoryRegistry.listFiles(repositoryToolRoute.id, {
            path: url.searchParams.get('path') || '.', limit,
          }))
        }
        const path = url.searchParams.get('path')
        if (!path) return json(response, 400, { error: 'repository-file-path-required' })
        return json(response, 200, { path, content: await repositoryRegistry.readFile(repositoryToolRoute.id, path) })
      } catch {
        return json(response, 400, { error: 'repository-request-rejected' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/agents/registry/status') {
      if (!agentRegistryService) return json(response, 503, { error: 'agent-registry-unavailable' })
      try {
        return json(response, 200, await agentRegistryService.status())
      } catch {
        return json(response, 503, { error: 'agent-registry-unavailable' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/agents/registry/sync') {
      if (!agentRegistryService) return json(response, 503, { error: 'agent-registry-unavailable' })
      try {
        const body = await readBody(request)
        const validated = validateRegistrySyncBody(body)
        if (!validated.ok) return json(response, 400, { error: validated.error })
        const result = await runAudited({ actionAudit, identity, action: 'agents.registry.sync' },
          async () => ({ status: 200, body: await agentRegistryService.sync() }))
        return json(response, result.status, result.body)
      } catch {
        return json(response, 503, { error: 'agent-registry-unavailable' })
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/agents/route') {
      if (!agentService) return json(response, 503, { matched: false, error: 'agent-routing-unavailable', reason: 'Agent routing unavailable.' })
      try {
        const body = await readBody(request)
        const promptResult = validateAgentPrompt(body.prompt)
        if (!promptResult.ok) return json(response, 400, promptResult.result)
        let requestedAgentId
        if (body.agentId != null) {
          const idResult = validateAgentId(body.agentId)
          if (!idResult.ok) return json(response, 400, { error: idResult.error })
          requestedAgentId = idResult.id
        }
        return json(response, 200, await agentService.route({ prompt: promptResult.prompt, requestedAgentId }))
      } catch {
        return json(response, 503, { matched: false, error: 'agent-routing-unavailable', reason: 'Agent routing unavailable.' })
      }
    }

    const agentAskRoute = parseAgentAskRoute(url.pathname)
    if (request.method === 'POST' && agentAskRoute) {
      if (agentAskRoute.invalid) return json(response, 400, { error: 'invalid-agent-id' })
      if (!agentService) return json(response, 503, { available: false, error: 'local-agent-unavailable', reason: 'Local agent inference unavailable.', execution: { ...NO_AGENT_EXECUTION } })
      try {
        const body = await readBody(request)
        const promptResult = validateAgentPrompt(body.prompt)
        if (!promptResult.ok) return json(response, 400, promptResult.result)
        const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl: buildEffectiveOverview })
        const result = await agentService.ask(agentAskRoute.agentId, { prompt: promptResult.prompt, overview })
        if (result.available) return json(response, 200, result)
        if (result.error === 'agent-unavailable') return json(response, 404, result)
        return json(response, 503, result)
      } catch {
        return json(response, 503, { available: false, error: 'local-agent-unavailable', reason: 'Local agent inference unavailable.', execution: { ...NO_AGENT_EXECUTION } })
      }
    }

    const agentDetailRoute = parseAgentDetailRoute(url.pathname)
    if (request.method === 'GET' && agentDetailRoute) {
      if (agentDetailRoute.invalid) return json(response, 400, { error: 'invalid-agent-id' })
      if (!agentRegistryService) return json(response, 503, { error: 'agent-registry-unavailable' })
      try {
        const agent = await agentRegistryService.get(agentDetailRoute.agentId)
        return agent ? json(response, 200, agent) : json(response, 404, { error: 'agent-not-found' })
      } catch {
        return json(response, 503, { error: 'agent-registry-unavailable' })
      }
    }

    const diagnosticRerunRoute = parseIncidentDiagnosticRerunRoute(url.pathname)
    if (request.method === 'POST' && diagnosticRerunRoute) {
      if (diagnosticRerunRoute.invalid) return json(response, 400, { error: 'invalid-incident-id' })
      const handler = monitoringRuntime?.rerunDiagnostic
      if (typeof handler !== 'function') return json(response, 503, { error: 'diagnostics-unavailable' })
      try {
        const result = await runAudited({ actionAudit, identity, action: 'incidents.diagnostics.rerun', target: diagnosticRerunRoute.incidentId },
          async () => {
            const outcome = await handler.call(monitoringRuntime, diagnosticRerunRoute.incidentId)
            return { status: outcome.statusCode, body: outcome.body }
          })
        return json(response, result.status, result.body)
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
        const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl: buildEffectiveOverview })

        let route = null
        if (agentService) {
          try {
            route = await agentService.route({ prompt: promptResult.prompt })
          } catch {
            route = null
          }
        }

        if (route?.matched === true) {
          if (!route.agentId) return json(response, 503, localAgentUnavailable(route))
          try {
            const agentResult = await agentService.ask(route.agentId, {
              prompt: promptResult.prompt,
              overview,
            })
            const routedResult = {
              ...agentResult,
              mode: 'local-agent',
              provider: 'ollama',
              ...(!agentResult.agentId ? { agentId: route.agentId } : {}),
              ...(!agentResult.agentName && route.agentName ? { agentName: route.agentName } : {}),
              ...(!agentResult.available ? { error: 'local-agent-unavailable' } : {}),
              routing: matchedRoutingProvenance(route),
              execution: { ...NO_AGENT_EXECUTION },
            }
            return json(response, routedResult.available ? 200 : 503, routedResult)
          } catch {
            return json(response, 503, localAgentUnavailable(route))
          }
        }

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

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/api/')) {
      return json(response, 404, { error: 'not-found' })
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (serveStatic(url.pathname, response)) return
    }

    json(response, 404, { error: 'not-found' })
  })
}
