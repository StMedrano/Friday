import { readWebGrowth } from './adapters/web-growth.mjs'
import { validateWebGrowthSnapshot } from './adapters/web-growth-schema.mjs'
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { previewCommand } from './core.mjs'
import { buildOverview, decorateOverviewWithMonitoring } from './overview.mjs'
import { answerAssistant } from './assistant.mjs'
import { normalizeAssistantHistory, validateAssistantPrompt } from './assistant-input.mjs'
import { validateAgentId, validateAgentPrompt, validateRegistrySyncBody } from './agents/input.mjs'
import {createCloudflareAccessVerifier} from './security/cloudflare-access.mjs'
import { getGroupWorkspace } from './agents/group-workspace.mjs'
import { groupAdvisoryPolicy } from './agents/group-advisory.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'dist')
const SAFE_INCIDENT_ID = /^[A-Za-z0-9_.-]{1,256}$/
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
  buildOverviewImpl = buildOverview,
  answerAssistantImpl = answerAssistant,
  readWebGrowthImpl = readWebGrowth,
  verifyAccessImpl = createCloudflareAccessVerifier(),
} = {}) {
  if (!config) throw new Error('Friday server config is required')
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

    // Verify Cloudflare's SIGNED application JWT at the origin, before any
    // monitored inventory, agent service or external model can be reached.
    // Status endpoints remain limited, public health probes.
    let authenticatedIdentity=null
    // Protect the static UI and assets as well as all API routes at origin.
    // Without a signed Access token, a direct backend connection cannot read
    // inventory or fetch the UI even if the edge policy is misconfigured.
    if (config.access?.enabled === true) {
      let verified
      try { verified=await verifyAccessImpl(request,config.access) }
      catch { verified={ok:false,status:503,error:'access-verification-unavailable'} }
      if (!verified?.ok) return json(response, verified?.status===503?503:401,{error:verified?.error||'access-identity-required'})
      authenticatedIdentity=verified
      // Prevent credentialed cross-site POSTs from abusing Access browser
      // cookies. Non-browser operator clients have no Origin header.
      if (request.method !== 'GET' && request.method !== 'HEAD' &&
          (!config.access.publicOrigin || (request.headers.origin&&request.headers.origin!==config.access.publicOrigin))) {
        return json(response,403,{error:'origin-denied'})
      }
      const isOperatorMutation=request.method==='POST'&&(
        url.pathname==='/api/agents/registry/sync' ||
        /^\/api\/incidents\/[^/]+\/diagnostics\/rerun$/.test(url.pathname))
      if (isOperatorMutation&&!authenticatedIdentity.operator) return json(response,403,{error:'operator-required'})

      // Small process-local resource guard; deployed ingress must also apply
      // distributed request quotas and abusive-client controls.
      const isExpensive=request.method==='POST'&&(
        url.pathname==='/api/assistant'||url.pathname==='/api/group-advisory'||url.pathname==='/api/agents/route'||
        /^\/api\/agents\/[^/]+\/ask$/.test(url.pathname)||isOperatorMutation)
      if (isExpensive) {
        const time=Date.now()
        const key=authenticatedIdentity.email
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
    }

    if (url.pathname === '/api/web-growth') {
      // A fixed private project grant is separate from group membership/operator role.
      // Never connect private business data in the unauthenticated demo mode.
      if (!authenticatedIdentity || config.mode !== 'live') return json(response,503,{error:'web-growth-authentication-required'})
      if (!config.webGrowth?.readerEmails?.includes(authenticatedIdentity.email)) return json(response,403,{error:'web-growth-reader-required'})
      if (request.method !== 'GET') return json(response,405,{error:'read-only-endpoint'})
      if (url.search) return json(response,400,{error:'unexpected-query'})
      if (config.webGrowth.enabled !== true) return json(response,503,{error:'web-growth-unavailable'})
      try {
        return json(response,200,validateWebGrowthSnapshot(await readWebGrowthImpl(config.webGrowth)))
      } catch { return json(response,503,{error:'web-growth-unavailable'}) }
    }

    if (request.method === 'GET' && url.pathname === '/api/agent-groups') {
      if (config.mode !== 'mock' && !authenticatedIdentity) {
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

    if (request.method === 'GET' && url.pathname === '/api/agents') {
      if (!agentRegistryService) return json(response, 503, { error: 'agent-registry-unavailable' })
      try {
        return json(response, 200, await agentRegistryService.list())
      } catch {
        return json(response, 503, { error: 'agent-registry-unavailable' })
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
        return json(response, 200, await agentRegistryService.sync())
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
        const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl })
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

    if (request.method === 'POST' && url.pathname === '/api/group-advisory') {
      const execution = { performed: false, reason: 'Friday group assistance is advisory only.' }
      if (config.mode !== 'mock' && !authenticatedIdentity) {
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
        const overview = await currentOverview({ config, monitoringRuntime, buildOverviewImpl })

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
