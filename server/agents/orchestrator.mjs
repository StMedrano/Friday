import { askOllama } from '../ai/ollama.mjs'

function noMatch(reason = 'No safe agent match.') {
  return { matched: false, routing: 'none', confidence: 0, reason }
}

function eligibleAgents(agents) {
  return Array.isArray(agents) ? agents.filter((agent) => agent?.enabled !== false && String(agent?.id || '').trim()) : []
}

function deterministicMatch(prompt, agents) {
  const text = String(prompt || '')
  const proxmox = agents.find((agent) => agent.id === 'proxmox-observer')
  if (!proxmox) return null

  const strongProxmox = /\bproxmox\b/i.test(text)
  const lxcId = /\blxc\s*[-#]?\s*\d+\b/i.test(text)
  const ctId = /\bct\s*[-#]?\s*\d+\b/i.test(text)
  return strongProxmox || lxcId || ctId ? proxmox : null
}

function routingCandidate(agent) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    scope: agent.scope && typeof agent.scope === 'object' ? agent.scope : {},
  }
}

export async function routeAgent({
  prompt,
  requestedAgentId,
  agents = [],
  localRouter,
} = {}) {
  const candidates = eligibleAgents(agents)
  const requestedId = String(requestedAgentId || '').trim()

  if (requestedId) {
    const selected = candidates.find((agent) => agent.id === requestedId)
    if (!selected) return noMatch('Requested agent is unavailable.')
    return {
      matched: true,
      agentId: selected.id,
      agentName: selected.name,
      routing: 'manual',
      confidence: 1,
      reason: 'Explicit agent override.',
    }
  }

  const deterministic = deterministicMatch(prompt, candidates)
  if (deterministic) {
    return {
      matched: true,
      agentId: deterministic.id,
      agentName: deterministic.name,
      routing: 'deterministic',
      confidence: 0.98,
      reason: 'Strong deterministic scope match.',
    }
  }

  if (typeof localRouter !== 'function' || candidates.length === 0) return noMatch()

  let selectedId
  try {
    selectedId = String(await localRouter({
      prompt: String(prompt || '').trim(),
      candidates: candidates.map(routingCandidate),
    }) || '').trim()
  } catch {
    return noMatch('Local agent router unavailable.')
  }

  if (!selectedId || selectedId === 'NO_MATCH') return noMatch()
  const selected = candidates.find((agent) => agent.id === selectedId)
  if (!selected) return noMatch()

  return {
    matched: true,
    agentId: selected.id,
    agentName: selected.name,
    routing: 'local-router',
    confidence: 0.6,
    reason: 'Local router selected a registered agent.',
  }
}

export function createLocalRouter({
  modelProfile,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function localRouter({ prompt, candidates = [] } = {}) {
    if (
      !modelProfile ||
      modelProfile.provider !== 'ollama' ||
      !String(modelProfile.baseUrl || '').trim() ||
      !String(modelProfile.model || '').trim()
    ) {
      const error = new Error('Friday local router model profile unavailable')
      error.code = 'FRIDAY_LOCAL_ROUTER_UNAVAILABLE'
      throw error
    }

    const allowed = Array.isArray(candidates)
      ? candidates.filter((candidate) => String(candidate?.id || '').trim())
      : []
    if (allowed.length === 0) return 'NO_MATCH'

    const systemPrompt = [
      'You are the Friday local agent router.',
      'Return exactly one candidate agent ID or NO_MATCH.',
      'Do not answer the operator request.',
      'Do not invent, alter, combine, or explain an agent ID.',
    ].join('\n')

    const overview = [
      'Candidate agents:',
      ...allowed.map((candidate) => `${candidate.id}: ${candidate.name || candidate.id} | ${candidate.description || ''} | scope=${JSON.stringify(candidate.scope || {})}`),
    ].join('\n')

    const result = await askOllama({
      providerConfig: {
        enabled: true,
        baseUrl: modelProfile.baseUrl,
        model: modelProfile.model,
        context: modelProfile.context || 8192,
        maxTokens: modelProfile.maxTokens || 128,
      },
      prompt: String(prompt || '').trim(),
      overview,
      systemPrompt,
      fetchImpl,
    })

    const text = String(result?.text || '').trim()
    return allowed.some((candidate) => candidate.id === text) ? text : 'NO_MATCH'
  }
}
