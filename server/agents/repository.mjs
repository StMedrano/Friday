import fs from 'node:fs/promises'
import path from 'node:path'

export class LocalAgentRepository {
  constructor({ directory = './agents', cachePath = './data/agents-cache.json' } = {}) {
    this.directory = directory
    this.cachePath = cachePath
  }

  async list() {
    const entries = await fs.readdir(this.directory, { withFileTypes: true }).catch(() => [])
    const agents = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(this.directory, entry.name), 'utf8')
      const agent = JSON.parse(raw)
      if (agent?.enabled === false) continue
      agents.push(agent)
    }
    return agents.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
  }

  async get(id) {
    const agents = await this.list()
    return agents.find(agent => agent.id === id) || null
  }

  async writeCache(agents) {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
    await fs.writeFile(this.cachePath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      agents,
    }, null, 2))
  }

  async readCache() {
    const raw = await fs.readFile(this.cachePath, 'utf8').catch(() => '')
    if (!raw) return []
    const payload = JSON.parse(raw)
    return Array.isArray(payload?.agents) ? payload.agents : []
  }
}

export function createAgentRepositoryFromEnv(env = process.env) {
  return new LocalAgentRepository({
    directory: env.FRIDAY_AGENT_LOCAL_DIR || './agents',
    cachePath: env.FRIDAY_AGENT_CACHE_PATH || './data/agents-cache.json',
  })
}
