function registryUnavailable() {
  const error = new Error('Friday agent registry unavailable')
  error.code = 'FRIDAY_AGENT_REGISTRY_UNAVAILABLE'
  return error
}

export function createSupabaseRegistryClient({
  baseUrl,
  serviceKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  const key = String(serviceKey || '')

  async function request(path, { method = 'GET', body, prefer } = {}) {
    if (!root || !key || typeof fetchImpl !== 'function') throw registryUnavailable()

    const headers = {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    }
    if (prefer) headers.prefer = prefer

    let response
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      throw registryUnavailable()
    }

    if (!response?.ok) throw registryUnavailable()
    try {
      return await response.json()
    } catch {
      throw registryUnavailable()
    }
  }

  return {
    async listAgents() {
      const rows = await request('/rest/v1/friday_agents?select=*')
      return Array.isArray(rows) ? rows : []
    },

    async getAgent(id) {
      const encodedId = encodeURIComponent(String(id || ''))
      const rows = await request(`/rest/v1/friday_agents?id=eq.${encodedId}&select=*`)
      return Array.isArray(rows) ? rows[0] ?? null : null
    },

    async upsertAgent(row) {
      const rows = await request('/rest/v1/friday_agents?on_conflict=id', {
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=representation',
      })
      return Array.isArray(rows) ? rows[0] ?? null : null
    },

    async getRegistryState() {
      const rows = await request('/rest/v1/friday_agent_registry_state?id=eq.current&select=*')
      return Array.isArray(rows) ? rows[0] ?? null : null
    },

    async upsertRegistryState(row) {
      const rows = await request('/rest/v1/friday_agent_registry_state?on_conflict=id', {
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=representation',
      })
      return Array.isArray(rows) ? rows[0] ?? null : null
    },
  }
}
