function toAgent(row) {
  if (!row) return null
  return {
    version: row.spec_version,
    id: row.id,
    name: row.name,
    description: row.description || '',
    enabled: row.enabled !== false,
    model: { profile: row.model_profile },
    scope: row.scope_json && typeof row.scope_json === 'object' ? row.scope_json : {},
    tools: Array.isArray(row.tools_json) ? row.tools_json : [],
    permissions: row.permissions_json && typeof row.permissions_json === 'object' ? row.permissions_json : {},
    instructions: Array.isArray(row.instructions_json) ? row.instructions_json : [],
    source: {
      path: row.source_path,
      checksum: row.source_checksum,
      syncedAt: row.synced_at,
    },
  }
}

function toStatus(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.last_sync_status,
    lastSyncAt: row.last_sync_at,
    sourceCommit: row.source_commit,
    agentsSeen: row.agents_seen,
    agentsSynced: row.agents_synced,
    agentsRejected: row.agents_rejected,
    errors: Array.isArray(row.error_summary) ? row.error_summary : [],
  }
}

export function createAgentRegistryService({
  registryClient,
  syncImpl,
  syncContext = {},
} = {}) {
  return {
    async list() {
      const rows = await registryClient.listAgents()
      return rows.map(toAgent)
    },

    async get(id) {
      return toAgent(await registryClient.getAgent(id))
    },

    async status() {
      return toStatus(await registryClient.getRegistryState())
    },

    async sync() {
      if (typeof syncImpl !== 'function') {
        const error = new Error('Friday agent registry sync unavailable')
        error.code = 'FRIDAY_AGENT_REGISTRY_SYNC_UNAVAILABLE'
        throw error
      }
      return syncImpl({ ...syncContext, registryClient })
    },
  }
}
