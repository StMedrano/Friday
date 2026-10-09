import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { validateAgentSpec } from '../ai/agent-runtime.mjs'

function sourcePath(filename) {
  return `agents/${filename}`
}

function rejection(filename, code) {
  return { file: sourcePath(filename), code }
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function syncedRow(agent, { filename, bytes, syncedAt }) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    spec_version: agent.version,
    source_path: sourcePath(filename),
    source_checksum: checksum(bytes),
    enabled: agent.enabled !== false,
    model_profile: agent.model.profile,
    scope_json: agent.scope || {},
    tools_json: agent.tools,
    permissions_json: agent.permissions,
    instructions_json: Array.isArray(agent.instructions) ? agent.instructions : [],
    synced_at: syncedAt,
    updated_at: syncedAt,
  }
}

export async function syncAgentRegistry({
  agentsDir,
  sourceCommit = '',
  registryClient,
  modelProfiles = {},
  now = () => new Date(),
} = {}) {
  const entries = await readdir(agentsDir, { withFileTypes: true })
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()

  let agentsSynced = 0
  let agentsRejected = 0
  const errors = []
  const syncedAt = now().toISOString()

  for (const filename of filenames) {
    let bytes
    let agent
    try {
      bytes = await readFile(`${agentsDir}/${filename}`)
      agent = JSON.parse(bytes.toString('utf8'))
    } catch {
      agentsRejected += 1
      errors.push(rejection(filename, 'invalid-json'))
      continue
    }

    const validation = validateAgentSpec(agent)
    if (!validation.valid) {
      agentsRejected += 1
      errors.push(rejection(filename, 'invalid-spec'))
      continue
    }

    const profile = modelProfiles?.[agent.model.profile]
    if (!profile || profile.provider !== 'ollama') {
      agentsRejected += 1
      errors.push(rejection(filename, 'invalid-model-profile'))
      continue
    }

    await registryClient.upsertAgent(syncedRow(agent, { filename, bytes, syncedAt }))
    agentsSynced += 1
  }

  const result = {
    status: agentsRejected > 0 ? 'degraded' : 'ok',
    agentsSeen: filenames.length,
    agentsSynced,
    agentsRejected,
    errors,
  }

  await registryClient.upsertRegistryState({
    id: 'current',
    last_sync_at: syncedAt,
    last_sync_status: result.status,
    source_commit: sourceCommit || null,
    agents_seen: result.agentsSeen,
    agents_synced: result.agentsSynced,
    agents_rejected: result.agentsRejected,
    error_summary: errors,
  })

  return result
}
