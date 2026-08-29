import { randomUUID } from 'node:crypto'
import { executeAgentTool } from '../ai/tool-registry.mjs'
import { runLocalAgent } from '../ai/agent-runtime.mjs'
import { toPublicRepository } from '../repositories/repository.mjs'

const STOP_WORDS = new Set(['where', 'what', 'when', 'which', 'with', 'from', 'this', 'that', 'find', 'show', 'tell', 'repository', 'requests', 'handled'])

function searchTerms(prompt) {
  return [...new Set(String(prompt).toLowerCase().match(/[a-z0-9_.-]{4,}/g) || [])]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 3)
}

export function createAgentOrchestrator({
  agentRepository,
  repositoryRegistry,
  toolRegistry,
  runAgent = runLocalAgent,
} = {}) {
  if (!agentRepository) throw new TypeError('agentRepository is required')
  if (!repositoryRegistry) throw new TypeError('repositoryRegistry is required')
  if (!toolRegistry) throw new TypeError('toolRegistry is required')

  async function analyzeRepository({ repositoryId, prompt } = {}) {
    const states = ['QUEUED']
    const repository = await repositoryRegistry.get(String(repositoryId || ''))
    if (!repository || repository.enabled === false) {
      const error = new Error('Repository not found')
      error.code = 'FRIDAY_REPOSITORY_NOT_FOUND'
      throw error
    }

    const agent = await agentRepository.get('codebase-explorer')
    if (!agent) {
      const error = new Error('Codebase Explorer agent not found')
      error.code = 'FRIDAY_AGENT_NOT_FOUND'
      throw error
    }

    states.push('ANALYZING')
    const toolEvents = []
    const observations = []
    const audit = async (event) => { toolEvents.push(event) }

    async function inspect(tool, args = {}) {
      if (!agent.tools?.includes(tool) || !toolRegistry.get(tool)) return null
      const result = await executeAgentTool({
        registry: toolRegistry,
        agent,
        request: { tool, args: { repositoryId: repository.id, ...args } },
        audit,
        context: { repositoryId: repository.id },
      })
      observations.push({ tool, status: result.status, output: result.output, error: result.error, reason: result.reason })
      return result
    }

    try {
      await inspect('repo.status')
      await inspect('repo.list', { path: '.' })
      await inspect('repo.manifest')
      await inspect('repo.history')

      const resultPaths = []
      for (const query of searchTerms(prompt)) {
        const result = await inspect('repo.search', { query })
        for (const hit of result?.output?.results || []) {
          if (!resultPaths.includes(hit.path)) resultPaths.push(hit.path)
          if (resultPaths.length >= 4) break
        }
        if (resultPaths.length >= 4) break
      }
      for (const path of resultPaths) await inspect('repo.read', { path })

      const overview = JSON.stringify({
        repository: toPublicRepository(repository),
        observations,
        constraint: 'Use only these Friday-executed read-only observations. Do not invent repository state.',
      })
      const response = await runAgent({ agent, prompt: String(prompt || ''), overview })
      if (!response?.available && !response?.text) throw new Error(response?.reason || 'Agent unavailable')
      states.push('COMPLETED')
      return {
        id: randomUUID(),
        repositoryId: repository.id,
        agentId: 'codebase-explorer',
        status: 'COMPLETED',
        states,
        answer: response.text || response.answer || '',
        toolEvents,
      }
    } catch {
      states.push('FAILED')
      return {
        id: randomUUID(),
        repositoryId: repository.id,
        agentId: 'codebase-explorer',
        status: 'FAILED',
        states,
        answer: '',
        toolEvents,
        error: 'agent-failed',
      }
    }
  }

  return { analyzeRepository }
}
