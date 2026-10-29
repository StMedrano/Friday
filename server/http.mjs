import { projectMonitoringHistory } from './monitoring/history.mjs'
import { readWebGrowth } from './adapters/web-growth.mjs'
import { validateWebGrowthSnapshot } from './adapters/web-growth-schema.mjs'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { REPOSITORY_ID, toPublicRepository } from './repositories/repository.mjs'
import { readRegistryEntries, repositorySettingsView } from './repositories/managed-registry.mjs'
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
import { applyEndpointChecks, endpointChecksView, environmentEndpointChecks } from './endpoint-checks.mjs'
import { normalizeSubscription, vapidKeys } from './notifications/web-push.mjs'
import { getGroupWorkspace } from './agents/group-workspace.mjs'
import { groupAdvisoryPolicy } from './agents/group-advisory.mjs'

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

// Operator-only mutation boundary. A 32-byte random token, encoded as 64 hex
// characters, must be supplied by a trusted server-side environment variable.
// A browser-facing token or user-supplied identity header is never trusted.
function authorizedOperator(request, token) {
  if (typeof token !== 'string' || !/^[a-fA-F0-9]{64}$/.test(token)) return { status: 503, error: 'operator-auth-unconfigured' }
  const auth = request.headers.authorization
  const bearer = typeof auth === 'string' ? /^Bearer ([a-fA-F0-9]{64})$/.exec(auth) : null
  if (!bearer) return { status: 401, error: 'operator-auth-required' }
  const expected = createHash('sha256').update(token, 'utf8').digest()
  const provided = createHash('sha256').update(bearer[1], 'utf8').digest()
  if (!timingSafeEqual(expected, provided)) return { status: 401, error: 'operator-auth-required' }
  return null
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

// Operator-managed Friday settings collections: GET lists, POST creates,
// PUT /:id edits and DELETE /:id deletes. Every write is operator-only and audited.
const SETTINGS_COLLECTIONS = [
  {
    name: 'endpoints', root: '/api/settings/endpoints', id: /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    item: 'check', invalid: 'invalid-endpoint-check', unavailable: 'endpoint-checks-unavailable',
    errors: { 'invalid-endpoint-check': 400, 'endpoint-check-not-found': 404, 'endpoint-check-exists': 409, 'endpoint-check-limit': 409 },
  },
  {
    name: 'repositories', root: '/api/settings/repositories', id: REPOSITORY_ID,
    item: 'repository', invalid: 'invalid-repository', unavailable: 'repository-settings-unavailable',
    errors: {
      'invalid-repository': 400, 'repository-path-not-allowed': 400, 'repository-not-git': 400,
      'repository-not-found': 404, 'repository-exists': 409, 'repository-limit': 409,
    },
  },
]

function settingsCollectionFor(pathname) {
  return SETTINGS_COLLECTIONS.find(collection => pathname === collection.root || pathname.startsWith(collection.root + '/')) || null
}

function parseSettingsCollectionRoute(collection, method, pathname) {
  if (pathname === collection.root) {
    if (method === 'GET') return { action: 'list', id: null }
    if (method === 'POST') return { action: 'create', id: null }
    return null
  }
  const id = pathname.slice(collection.root.length + 1)
  if (!collection.id.test(id)) return null
  if (method === 'PUT') return { action: 'update', id }
  if (method === 'DELETE') return { action: 'delete', id }
  return null
}

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
  projectTasks = null,
  repositoryRegistry = null,
  buildOverviewImpl = buildOverview,
  answerAssistantImpl = answerAssistant,
  accessGateImpl = null,
  workReadBridge = null,
  actionAudit = null,
  siteSettings = null,
  endpointChecks = null,
  repositorySettings = null,
  pushSubscriptions = null,
  readWebGrowthImpl = readWebGrowth,
  verifyAccessImpl = null,
} = {}) {
  if (!config) throw new Error('Friday server config is required')
  const labelledConfig = (effectiveConfig = config) =>
    siteSettings ? applySiteSettings(effectiveConfig, siteSettings.get()) : effectiveConfig
  const buildEffectiveOverview = (effectiveConfig) => {
    const labelled = labelledConfig(effectiveConfig)
    return buildOverviewImpl(endpointChecks ? applyEndpointChecks(labelled, endpointChecks.get()) : labelled)
  }
  const securityRequired = config.access?.enabled === true ||
    (config.mode === 'live' && config.access?.enabled !== false)
  const compatibilityGate = verifyAccessImpl ? async (request, operatorOnly) => {
    const verified = await verifyAccessImpl(request, config.access)
    if (!verified?.ok) return { status: verified?.status || 403, error: verified?.error || 'access-denied' }
    if (operatorOnly && !verified.operator) return { status: 403, error: 'access-denied' }
    return { status: 200, identity: {
      subject: verified.subject || verified.sub || verified.email,
      principalId: verified.principalId || verified.subject || verified.sub || verified.email,
      email: verified.email,
      operator: verified.operator === true,
    } }
  } : null
  const accessGate = securityRequired ? (accessGateImpl || compatibilityGate || createAccessGate(config.access)) : null
  const accessUsage=new Map()
  const MAX_ACCESS_OPERATIONS_PER_MINUTE=20

  return createServer(async (request, response) => {
    let url
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    } catch {
      return json(response, 400, { error: 'invalid-request-url' })
    }

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
      const collectionWrite = request.method !== 'GET' && request.method !== 'HEAD' && Boolean(settingsCollectionFor(url.pathname))
      const pushWrite = (request.method === 'POST' || request.method === 'DELETE') && url.pathname === '/api/notifications/web-push'
      const projectTaskWrite = request.method === 'POST' && /^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\/tasks$/.test(url.pathname)
      const diagnosticsRerun = request.method === 'POST' && /^\/api\/incidents\/[^/]+\/diagnostics\/rerun$/.test(url.pathname)
      const operatorOnly = registrySync || siteSettingsWrite || collectionWrite || diagnosticsRerun || url.pathname === '/api/audit/events'
      let verdict
      try { verdict = await accessGate(request, operatorOnly) }
      catch { verdict = {status:503,error:'access-verification-unavailable'} }
      if (verdict?.status !== 200) {
        const denied = verdict?.status === 503
        return json(response, denied ? 503 : verdict?.status === 401 ? 401 : 403, {error:denied?'access-verification-unavailable':'access-denied'})
      }
      identity = verdict.identity ? { ok: true, ...verdict.identity } : null
      // Do not allow browser-origin cross-site requests to use a verified session
      // for operational POST/PUT/DELETE handlers. Settings and registry writes with a body additionally require JSON.
      if (['POST', 'PUT', 'DELETE'].includes(request.method) && request.headers['sec-fetch-site'] === 'cross-site')
        return json(response, 403, {error:'access-denied'})
      if (['POST', 'PUT', 'DELETE'].includes(request.method) && config.access?.publicOrigin &&
        request.headers.origin && request.headers.origin !== config.access.publicOrigin)
        return json(response, 403, {error:'access-denied'})
      if (projectTaskWrite && config.access?.publicOrigin && request.headers.origin !== config.access.publicOrigin)
        return json(response, 403, {error:'access-denied'})
      if ((registrySync || siteSettingsWrite || pushWrite || projectTaskWrite || (collectionWrite && request.method !== 'DELETE')) && !/^application\/json(?:\s*;|\s*$)/i.test(String(request.headers['content-type']||'')))
        return json(response, 415, {error:'json-required'})
    }

    // Opt-in read-only transport; server/index.mjs does not inject a bridge.
    // The bridge independently verifies the signed Access human JWT and
    // resolves private grants on every request; no browser-supplied roles.
    const workRead = await handleWorkReadHttp({request,url,bridge:workReadBridge})
    if (workRead) return json(response, workRead.status, workRead.body)

    // Small process-local resource guard; deployed ingress must also apply
    // distributed request quotas and abusive-client controls.
    const isExpensive=request.method==='POST'&&(
      /^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\/tasks$/.test(url.pathname)||
      url.pathname==='/api/assistant'||url.pathname==='/api/group-advisory'||url.pathname==='/api/agents/route'||
      /^\/api\/agents\/[^/]+\/ask$/.test(url.pathname)||
      url.pathname==='/api/agents/registry/sync'||
      /^\/api\/incidents\/[^/]+\/diagnostics\/rerun$/.test(url.pathname))
    if (isExpensive && identity?.email) {
      const time=Date.now()
      const key=identity.email
      const prior=accessUsage.get(key)
      const state=!prior||prior.until<=time?{count:0,until:time+60000}:prior
      if(state.count>=MAX_ACCESS_OPERATIONS_PER_MINUTE) return json(response,429,{error:'rate-limit-exceeded'})
      state.count+=1
      if(accessUsage.size>=2000&&!accessUsage.has(key)){
        for(const [id,entry] of accessUsage)if(entry.until<=time)accessUsage.delete(id)
        if(accessUsage.size>=2000)accessUsage.clear()
      }
      accessUsage.set(key,state)
    }

    const projectTaskRoute=/^\/api\/projects\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})\/tasks$/.exec(url.pathname)
    if (url.pathname === '/api/projects' || projectTaskRoute) {
      // Explicit local-development injection only; bootstrap never creates this service.
      if (!identity || config.mode !== 'live' || !projectTasks) return json(response,503,{error:'project-tasks-unavailable'})
      if (url.search && (!projectTaskRoute || request.method!=='GET' || [...url.searchParams.keys()].some(key=>key!=='cursor') || url.searchParams.getAll('cursor').length!==1)) return json(response,400,{error:'unexpected-query'})
      if (request.method!=='GET' && !(projectTaskRoute && request.method==='POST')) return json(response,405,{error:'method-not-allowed'})
      try {
        if (!projectTaskRoute) return json(response,200,{projects:await projectTasks.projects(identity)})
        const projectId=projectTaskRoute[1]
        if (request.method==='GET') return json(response,200,await projectTasks.page(identity,projectId,url.searchParams.has('cursor')?url.searchParams.get('cursor'):undefined))
        let body
        try {body=await readBody(request)}catch{return json(response,400,{error:'invalid-input'})}
        return json(response,201,{task:await projectTasks.create(identity,projectId,body)})
      } catch(error) {
        const status={ 'not-authorized':403,'invalid-input':400,'idempotency-conflict':409 }[error?.kind]||503
        return json(response,status,{error:status===503?'project-tasks-unavailable':error.kind})
      }
    }

    if (url.pathname === '/api/web-growth') {
      // A fixed private project grant is separate from group membership/operator role.
      // Never connect private business data in the unauthenticated demo mode.
      if (!identity || config.mode !== 'live') return json(response,503,{error:'web-growth-authentication-required'})
      if (!config.webGrowth?.readerEmails?.includes(identity.email)) return json(response,403,{error:'web-growth-reader-required'})
      if (request.method !== 'GET') return json(response,405,{error:'read-only-endpoint'})
      if (url.search) return json(response,400,{error:'unexpected-query'})
      if (config.webGrowth.enabled !== true) return json(response,503,{error:'web-growth-unavailable'})
      try {
        return json(response,200,validateWebGrowthSnapshot(await readWebGrowthImpl(config.webGrowth)))
      } catch { return json(response,503,{error:'web-growth-unavailable'}) }
    }

    if (request.method === 'GET' && url.pathname === '/api/agent-groups') {
      if (config.mode !== 'mock' && !identity) {
        return json(response, 503, { error: 'access-unconfigured' })
      }
      try {
        return json(response, 200, await getGroupWorkspace({ registryService: agentRegistryService }))
      } catch {
        return json(response, 503, { error: 'group-workspace-unavailable' })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/overview') {
      try {
        return json(response, 200, await currentOverview({ config, monitoringRuntime, buildOverviewImpl: buildEffectiveOverview }))
      } catch (error) {
        return json(response, 500, { error: 'overview-failed', detail: error.message })
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/settings') {
      return json(response, 200, buildSettingsView(endpointChecks ? applyEndpointChecks(labelledConfig(), endpointChecks.get()) : labelledConfig(), { actionAudit }))
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

    const settingsCollection = settingsCollectionFor(url.pathname)
    const settingsRoute = settingsCollection && parseSettingsCollectionRoute(settingsCollection, request.method, url.pathname)
    if (settingsRoute) {
      const binding = settingsCollection.name === 'endpoints'
        ? endpointChecks && {
          store: endpointChecks,
          // Seed and list from the site-labelled config so operator site labels carry over.
          view: async () => endpointChecksView(labelledConfig(), endpointChecks.get()),
          baseline: async () => environmentEndpointChecks(labelledConfig().endpoints),
          // A deleted check is never polled again, so retire its open incidents explicitly.
          afterDelete: id => monitoringRuntime?.retireService?.(`endpoint-${id}`, 'endpoint check deleted'),
        }
        : repositorySettings && {
          store: repositorySettings,
          view: () => repositorySettingsView(config.repositories, repositorySettings.get()),
          baseline: () => readRegistryEntries(config.repositories?.registryPath),
        }
      const unavailable = { status: 503, body: { error: settingsCollection.unavailable } }
      if (!binding) return json(response, unavailable.status, unavailable.body)
      if (settingsRoute.action === 'list') {
        try { return json(response, 200, await binding.view()) }
        catch { return json(response, unavailable.status, unavailable.body) }
      }
      const result = await runAudited({ actionAudit, identity, action: `settings.${settingsCollection.name}.${settingsRoute.action}`, target: settingsRoute.id }, async () => {
        let body = null
        if (settingsRoute.action !== 'delete') {
          try { body = await readBody(request) } catch { return { status: 400, body: { error: 'invalid-json' } } }
        }
        let item
        try {
          // The env/file baseline only seeds the first write; once managed it is ignored.
          const baseline = binding.store.get() ? null : await binding.baseline()
          if (settingsRoute.action === 'create') item = await binding.store.create(body, baseline)
          else if (settingsRoute.action === 'update') item = await binding.store.update(settingsRoute.id, body, baseline)
          else await binding.store.remove(settingsRoute.id, baseline)
        } catch (error) {
          const status = settingsCollection.errors[error?.code]
          if (!status) return unavailable
          return { status, body: { error: error.code === settingsCollection.invalid ? error.message : error.code } }
        }
        if (settingsRoute.action === 'delete' && binding.afterDelete) {
          try { await binding.afterDelete(settingsRoute.id) }
          catch { console.warn(`Friday could not retire monitoring state for deleted ${settingsCollection.name} entry`) }
        }
        let view
        try { view = await binding.view() } catch { return unavailable }
        return { status: settingsRoute.action === 'create' ? 201 : 200, body: item ? { ...view, [settingsCollection.item]: item } : view }
      })
      return json(response, result.status, result.body)
    }

    if (request.method === 'GET' && url.pathname === '/api/incidents') {
      return json(response, 200, monitoringRuntime?.getIncidents?.() || { summary: { active: 0, high: 0, warning: 0, resolved: 0 }, incidents: [] })
    }

    if (request.method === 'GET' && url.pathname === '/api/monitoring/history') {
      if (config.monitoring?.enabled === false) return json(response,503,{error:'monitoring-disabled'})
      if (typeof monitoringRuntime?.getHistory !== 'function') return json(response,503,{error:'monitoring-history-unavailable'})
      let history
      try { history=await monitoringRuntime.getHistory() }
      catch { return json(response,503,{error:'monitoring-history-unavailable'}) }
      try { return json(response,200,projectMonitoringHistory(history)) }
      catch { return json(response,502,{error:'monitoring-history-invalid'}) }
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
      const denial = authorizedOperator(request, config.operator?.registrySyncToken)
      if (denial) return json(response, denial.status, { error: denial.error })
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

    if (request.method === 'POST' && url.pathname === '/api/group-advisory') {
      const execution = { performed: false, reason: 'Friday group assistance is advisory only.' }
      if (config.mode !== 'mock' && !identity) {
        return json(response, 503, { available: false, error: 'access-unconfigured', execution })
      }
      let body
      try { body = await readBody(request) } catch {
        return json(response, 400, { available: false, error: 'invalid-brief', execution })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 2 || typeof body.groupId !== 'string' || typeof body.prompt !== 'string' ||
          !Object.hasOwn(body, 'groupId') || !Object.hasOwn(body, 'prompt')) {
        return json(response, 400, { available: false, error: 'invalid-brief', execution })
      }
      const systemPrompt = groupAdvisoryPolicy(body.groupId)
      const validated = validateAssistantPrompt(body.prompt)
      if (!systemPrompt || !validated.ok) {
        return json(response, 400, { available: false, error: 'invalid-brief', execution })
      }
      try {
        const overview = body.groupId === 'homelab'
          ? await currentOverview({ config, monitoringRuntime, buildOverviewImpl }) : {}
        const result = await answerAssistantImpl({ config, prompt: validated.prompt, overview, systemPrompt })
        if (!result.available || result.mode === 'local-analysis') {
          return json(response, 503, { available: false, groupId: body.groupId,
            reason: 'Group advice requires an available AI provider. No plan was generated.', execution })
        }
        if (typeof result.text !== 'string' || !result.text.trim() ||
            !['cloud-ai', 'local-ai'].includes(result.mode)) {
          return json(response, 502, { available: false, error: 'group-advice-unavailable', execution })
        }
        return json(response, 200, { available: true, groupId: body.groupId,
          text: result.text, mode: result.mode, provider: result.provider, model: result.model,
          fallbackUsed: result.fallbackUsed, attempts: result.attempts, execution })
      } catch {
        return json(response, 502, { available: false, error: 'group-advice-unavailable', execution })
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
