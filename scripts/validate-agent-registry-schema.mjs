import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const REQUIRED = {
  friday_agents: [
    'id', 'name', 'description', 'spec_version', 'source_path', 'source_checksum', 'enabled',
    'model_profile', 'scope_json', 'tools_json', 'permissions_json', 'instructions_json',
    'synced_at', 'created_at', 'updated_at',
  ],
  friday_agent_registry_state: [
    'id', 'last_sync_at', 'last_sync_status', 'source_commit', 'agents_seen', 'agents_synced',
    'agents_rejected', 'error_summary',
  ],
}

const APPROVED_TABLES = Object.keys(REQUIRED).sort()
const FORBIDDEN_NAME = /(action|approval|task|memory|executor|execution)/i

function stripComments(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
}

function parseTables(sql) {
  const clean = stripComments(sql)
  const tables = new Map()
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(?:public\.)?)([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*?)\)\s*;/gi
  let match
  while ((match = pattern.exec(clean)) !== null) {
    const name = match[1].toLowerCase()
    const columns = []
    for (const line of match[2].split(/\r?\n/)) {
      const trimmed = line.trim().replace(/,$/, '')
      const column = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/)?.[1]?.toLowerCase()
      if (!column) continue
      if (['primary', 'foreign', 'unique', 'constraint', 'check'].includes(column)) continue
      columns.push(column)
    }
    tables.set(name, columns)
  }
  return tables
}

export function validateAgentRegistrySchema(sql) {
  const parsed = parseTables(sql)
  const tables = [...parsed.keys()].sort()
  const errors = []

  for (const table of tables) {
    if (FORBIDDEN_NAME.test(table)) errors.push(`Forbidden Phase 1 table: ${table}`)
    if (!APPROVED_TABLES.includes(table)) errors.push(`Unexpected table in Phase 1 migration: ${table}`)
  }

  for (const approved of APPROVED_TABLES) {
    if (!parsed.has(approved)) {
      errors.push(`Missing required table: ${approved}`)
      continue
    }
    const columns = new Set(parsed.get(approved))
    for (const requiredColumn of REQUIRED[approved]) {
      if (!columns.has(requiredColumn)) errors.push(`Missing required column: ${approved}.${requiredColumn}`)
    }
  }

  if (tables.length !== APPROVED_TABLES.length) {
    errors.push(`Phase 1 registry must create exactly ${APPROVED_TABLES.length} tables; found ${tables.length}.`)
  }

  return { ok: errors.length === 0, tables, errors }
}

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('FAIL agent registry schema: migration path required')
    process.exitCode = 2
    return
  }

  try {
    const sql = await readFile(file, 'utf8')
    const result = validateAgentRegistrySchema(sql)
    if (!result.ok) {
      for (const error of result.errors) console.error(`FAIL agent registry schema: ${error}`)
      process.exitCode = 1
      return
    }
    console.log(`PASS agent registry schema: ${result.tables.join(', ')}`)
  } catch {
    console.error('FAIL agent registry schema: migration unavailable')
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
