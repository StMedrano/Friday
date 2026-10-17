import { runLocalAgent } from '../ai/agent-runtime.mjs'
import { resolveModelProfile } from './model-profiles.mjs'
import { createLocalRouter, routeAgent } from './orchestrator.mjs'

const NO_EXECUTION = Object.freeze({
  performed: false,
  reason: 'Phase 1 agents are advisory only.',
})

function unavailableAgent() {
  return {
    available: false,
    error: 'agent-unavailable',
    reason: 'Requested agent is unavailable.',
    execution: { ...NO_EXECUTION },
  }
}

export function createAgentService({
  registryService,
  config,
  routeAgentImpl = routeAgent,
  runLocalAgentImpl = runLocalAgent,
  resolveModelProfileImpl = resolveModelProfile,
  createLocalRouterImpl = createLocalRouter,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    async route({ prompt, requestedAgentId } = {}) {
      const agents = await registryService.list()
      const routerProfile = resolveModelProfileImpl(config, 'local-router')
      const localRouter = routerProfile
        ? createLocalRouterImpl({ modelProfile: routerProfile, fetchImpl })
        : undefined
      return routeAgentImpl({ prompt, requestedAgentId, agents, localRouter })
    },

    async ask(agentId, { prompt, overview } = {}) {
      const agent = await registryService.get(agentId)
      if (!agent || agent.enabled === false) return unavailableAgent()

      const modelProfile = resolveModelProfileImpl(config, agent.model?.profile)
      if (!modelProfile || modelProfile.provider !== 'ollama') {
        return {
          available: false,
          error: 'local-agent-unavailable',
          agentId: agent.id,
          agentName: agent.name,
          reason: 'Local agent inference unavailable.',
          execution: { ...NO_EXECUTION },
        }
      }

      try {
        const result = await runLocalAgentImpl({
          agent,
          modelProfile,
          prompt,
          overview,
          fetchImpl,
        })
        return {
          available: true,
          agentId: agent.id,
          agentName: agent.name,
          provider: 'ollama',
          modelProfile: modelProfile.id,
          model: result?.model || modelProfile.model,
          mode: 'local-agent',
          text: result?.text || '',
          execution: { ...NO_EXECUTION },
        }
      } catch {
        return {
          available: false,
          error: 'local-agent-unavailable',
          agentId: agent.id,
          agentName: agent.name,
          reason: 'Local agent inference unavailable.',
          execution: { ...NO_EXECUTION },
        }
      }
    },
  }
}
