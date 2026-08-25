import { askOllama } from './ollama.mjs'

const VALID_PERMISSION_MODES = new Set(['auto', 'approval', 'forbidden'])

export function validateAgentSpec(agent = {}) {
  const errors = []
  if (!agent || typeof agent !== 'object') errors.push('agent must be an object')
  if (!String(agent?.id || '').trim()) errors.push('id is required')
  if (!String(agent?.name || '').trim()) errors.push('name is required')
  if (agent?.model?.provider !== 'ollama') errors.push('model.provider must be ollama for local-agent v1')
  if (!String(agent?.model?.model || '').trim()) errors.push('model.model is required')
  if (!Array.isArray(agent?.tools)) errors.push('tools must be an array')
  if (!agent?.permissions || typeof agent.permissions !== 'object') errors.push('permissions must be an object')

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

  const providerConfig = {
    enabled: true,
    baseUrl: agent.model.baseUrl || 'http://127.0.0.1:11434',
    model: agent.model.model,
    context: agent.model.context || 8192,
    maxTokens: agent.model.maxTokens || 768,
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
