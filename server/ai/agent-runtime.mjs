import { askOllama } from './ollama.mjs'

const VALID_PERMISSION_MODES = new Set(['auto', 'approval', 'forbidden'])
const DEPLOYMENT_MODEL_FIELDS = ['provider', 'model', 'baseUrl', 'context', 'maxTokens']

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
    `You are Friday agent: ${agent.name}.`,
    agent.description ? `Purpose: ${agent.description}` : '',
    'You are a local-first homelab agent. Do not assume cloud services are available.',
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

  return askOllama({
    providerConfig,
    prompt,
    overview,
    systemPrompt: buildAgentSystemPrompt(agent),
    fetchImpl,
    signal,
  })
}
