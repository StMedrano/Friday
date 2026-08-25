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
      agents.push(JSON.parse(raw))
    }
    return agents
  }

  async get(id) {
    const agents = await this.list()
    return agents.find(agent => agent.id === id) || null
  }

  async writeCache(agents) {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true })
    await fs.writeFile(this.cachePath, JSON.stringify({ updatedAt: new Date().toISOString(), agents }, null, 2))
  }

  async readCache() {
    const raw = await fs.readFile(this.cachePath, 'utf8')
    const payload = JSON.parse(raw)
    return Array.isArray(payload?.agents) ? payload.agents : []
  }
}

export class SupabaseAgentRepository {
  constructor({ url, serviceRoleKey, fetchImpl = globalThis.fetch, cacheRepository = null } = {}) {
    this.url = String(url || '').replace(/\/$/, '')
    this.serviceRoleKey = serviceRoleKey
    this.fetchImpl = fetchImpl
    this.cacheRepository = cacheRepository
  }

  headers() {
    return {
      apikey: this.serviceRoleKey,
      Authorization: `Bearer ${this.serviceRoleKey}`,
      'Content-Type': 'application/json',
    }
  }

  async list() {
    if (!this.url || !this.serviceRoleKey || typeof this.fetchImpl !== 'function') {
      return this.cacheRepository ? this.cacheRepository.readCache() : []
    }

    try {
      const response = await this.fetchImpl(`${this.url}/rest/v1/agents?select=*&enabled=eq.true&order=name.asc`, {
        headers: this.headers(),
      })
      if (!response.ok) throw new Error(`Supabase agents request failed: ${response.status}`)
      const rows = await response.json()
      const agents = rows.map(row => row.definition || row)
      if (this.cacheRepository) await this.cacheRepository.writeCache(agents)
      return agents
    } catch (error) {
      if (this.cacheRepository) return this.cacheRepository.readCache()
      throw error
    }
  }

  async get(id) {
    const agents = await this.list()
    return agents.find(agent => agent.id === id) || null
  }
}

export function createAgentRepositoryFromEnv(env = process.env) {
  const local = new LocalAgentRepository({
    directory: env.FRIDAY_AGENT_LOCAL_DIR || './agents',
    cachePath: env.FRIDAY_AGENT_CACHE_PATH || './data/agents-cache.json',
  })

  if (String(env.FRIDAY_AGENT_REGISTRY || 'local').toLowerCase() !== 'supabase') return local

  return new SupabaseAgentRepository({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    cacheRepository: local,
  })
}
