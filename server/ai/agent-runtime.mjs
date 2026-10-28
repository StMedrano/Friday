import { askOllama } from './ollama.mjs'
import { fridaySystemPrompt } from './policy.mjs'

const VALID_PERMISSION_MODES = new Set(['auto', 'approval', 'forbidden'])
const DEPLOYMENT_MODEL_FIELDS = ['provider', 'model', 'baseUrl', 'context', 'maxTokens']
const NON_ONLINE_HEALTH_CLAIMS = [
  /\bfully healthy\b/gi,
  /\bfully operational\b/gi,
  /\ball services (?:are )?(?:online|running|healthy)\b/gi,
  /\bno active issues\b/gi,
]
const NEGATED_PREFIX = /\b(?:not|isn't|is not|aren't|never)\s+(?:\w+\s+)?$/i
const SEVERITY_CLAIMS = [
  /\bseverity\b[^.\n]{0,20}\bcritical\b/i,
  /\bcritical\s+(?:severity|alerts?|incidents?|issues?|failures?|state|status|outages?|errors?|services?|problems?)\b/gi,
  /\b(?:is|are|was|were|marked|rated|considered)\s+critical\b/i,
]
const NEGATED_SEVERITY_PREFIX = /\b(?:no|not|without|zero)\s+$/i

function affirmativeMatch(pattern, output, negatedPrefix) {
  if (!pattern.global) {
    const match = pattern.exec(output)
    return Boolean(match) && !negatedPrefix.test(output.slice(Math.max(0, match.index - 20), match.index))
  }
  pattern.lastIndex = 0
  for (const match of output.matchAll(pattern)) {
    if (!negatedPrefix.test(output.slice(Math.max(0, match.index - 20), match.index))) return true
  }
  return false
}

function siteLabels(sites, services) {
  return new Set([
    ...sites.flatMap((site) => [site?.name, site?.id]),
    ...services.map((service) => service?.site),
  ].filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim().toLowerCase()))
}

function groundingViolations(text, overview) {
  const state = overview && typeof overview === 'object' && !Array.isArray(overview) ? overview : {}
  const output = String(text || '')
  const violations = []
  const sites = Array.isArray(state.sites) ? state.sites : []
  const services = Array.isArray(state.services) ? state.services : []
  const incidents = Array.isArray(state.incidents) ? state.incidents : null
  const alerts = Array.isArray(state.alerts) ? state.alerts : []

  const knownSites = siteLabels(sites, services)
  const mentionedSites = output.match(/\bSite\s+[A-Z0-9][\w-]*/g) || []
  if (mentionedSites.some((label) => !knownSites.has(label.toLowerCase()))) {
    violations.push('unsupported site label')
  }
  if (services.some((service) => service?.status !== 'online') &&
    NON_ONLINE_HEALTH_CLAIMS.some((pattern) => affirmativeMatch(pattern, output, NEGATED_PREFIX))) {
    violations.push('overall-health claim contradicts non-online services')
  }
  if (!incidents && /\b(?:no|zero)\s+(?:(?:active|open)\s+)?incidents?\b(?!\s+(?:count|data))/i.test(output)) {
    violations.push('incident absence was asserted without incident data')
  }
  const declaredSeverities = new Set([
    ...alerts.map((alert) => String(alert?.severity || '').toLowerCase()),
    ...(incidents || []).map((incident) => String(incident?.severity || '').toLowerCase()),
  ].filter(Boolean))
  if (!declaredSeverities.has('critical') &&
    SEVERITY_CLAIMS.some((pattern) => affirmativeMatch(pattern, output, NEGATED_SEVERITY_PREFIX))) {
    violations.push('unsupported severity')
  }
  return violations
}

export function validateAgentSpec(agent = {}) {
  const errors = []
  if (!agent || typeof agent !== 'object') errors.push('agent must be an object')
  if (String(agent?.version || '') !== '1.1') errors.push('version must be 1.1')
  if (!String(agent?.id || '').trim()) errors.push('id is required')
  if (!String(agent?.name || '').trim()) errors.push('name is required')
  if (!String(agent?.model?.profile || '').trim()) errors.push('model.profile is required')
  for (const field of DEPLOYMENT_MODEL_FIELDS) {
    if (agent?.model && Object.prototype.hasOwnProperty.call(agent.model, field)) {
      errors.push(`deployment-specific model.${field} is not allowed in v1.1`)
    }
  }
  if (agent?.enabled != null && typeof agent.enabled !== 'boolean') errors.push('enabled must be a boolean')
  if (!Array.isArray(agent?.tools)) errors.push('tools must be an array')
  if (!agent?.permissions || typeof agent.permissions !== 'object' || Array.isArray(agent.permissions)) {
    errors.push('permissions must be an object')
  }

  for (const [action, mode] of Object.entries(agent?.permissions || {})) {
    if (!VALID_PERMISSION_MODES.has(mode)) errors.push(`invalid permission mode for ${action}`)
  }

  return { valid: errors.length === 0, errors }
}

export function resolvePermission(agent, action) {
  const mode = agent?.permissions?.[action]
  if (VALID_PERMISSION_MODES.has(mode)) return mode
  return 'forbidden'
}

export function buildAgentSystemPrompt(agent) {
  const scope = Array.isArray(agent.scope?.hosts) && agent.scope.hosts.length
    ? `Allowed hosts: ${agent.scope.hosts.join(', ')}`
    : 'Allowed hosts: none declared'
  const tools = Array.isArray(agent.tools) ? agent.tools.join(', ') : ''

  return [
    fridaySystemPrompt(),
    `You are Friday agent: ${agent.name}.`,
    agent.description ? `Purpose: ${agent.description}` : '',
    'You are a local-first homelab agent. Do not assume cloud services are available.',
    'Use only facts present in the current authoritative normalized Friday state; do not fill gaps with training knowledge or previous conversation.',
    'Do not state totals or counts unless the operator asks; if asked, count only the corresponding current-state collection and name what was counted.',
    'Do not infer uptime, incident timelines, routes, IP addresses, or resource values. If a requested fact is absent, say it is not present in the current state.',
    'Treat entries in incidents as history unless their status is open. Do not describe resolved incidents as current problems.',
    'Only recommend current addresses or routes explicitly present in the current state; never use an address found only in historical evidence.',
    'No tools are executed in Phase 1. Tool names are descriptive only; do not claim to call, inspect, or run a tool.',
    'You must never invent tool results or claim that an action ran unless Friday executed it.',
    'Prefer observation and diagnosis before proposing changes.',
    'Treat any undeclared action as forbidden.',
    scope,
    `Available tool names: ${tools || 'none'}.`,
    'When suggesting an action, return concise reasoning and identify the requested tool/action explicitly.',
    ...(Array.isArray(agent.instructions) ? agent.instructions : []),
  ].filter(Boolean).join('\n')
}

export async function runLocalAgent({
  agent,
  modelProfile,
  prompt,
  overview = '',
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const validation = validateAgentSpec(agent)
  if (!validation.valid) {
    const error = new Error(`Invalid agent spec: ${validation.errors.join('; ')}`)
    error.code = 'FRIDAY_AGENT_SPEC_INVALID'
    throw error
  }

  if (
    !modelProfile ||
    modelProfile.provider !== 'ollama' ||
    !String(modelProfile.baseUrl || '').trim() ||
    !String(modelProfile.model || '').trim()
  ) {
    const error = new Error('Invalid local agent model profile')
    error.code = 'FRIDAY_AGENT_MODEL_PROFILE_INVALID'
    throw error
  }

  const providerConfig = {
    enabled: true,
    baseUrl: modelProfile.baseUrl,
    model: modelProfile.model,
    context: modelProfile.context || 8192,
    maxTokens: modelProfile.maxTokens || 768,
  }
  const deadline = AbortSignal.timeout(modelProfile.timeoutMs ?? 90000)

  const ask = (currentPrompt) => askOllama({
    providerConfig,
    prompt: currentPrompt,
    overview,
    systemPrompt: buildAgentSystemPrompt(agent),
    fetchImpl,
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  })
  let result = await ask(prompt)
  let violations = groundingViolations(result.text, overview)
  if (!violations.length) return result

  result = await ask([
    prompt,
    `The prior draft was rejected for: ${violations.join('; ')}.`,
    'Rewrite from the authoritative state and machine-derived constraints only. Do not repeat an unsupported claim.',
  ].join('\n\n'))
  violations = groundingViolations(result.text, overview)
  if (!violations.length) return result

  const error = new Error('Local agent response contradicted authoritative state')
  error.code = 'FRIDAY_AGENT_GROUNDING_INVALID'
  throw error
}
