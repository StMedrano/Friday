#!/usr/bin/env node
// Offline check of a Friday .env file against the Compose files that pass it
// to the container. Prints variable names and line numbers only, never values.
//
//   node scripts/check-env.mjs <path/to/.env> [--compose compose.yaml]...
//
// Findings:
//   - variables set in .env that no given Compose file interpolates (they
//     never reach the container),
//   - *_ENABLED=true flags whose companion settings are empty, using the same
//     rules as Settings (server/settings.mjs), and
//   - malformed and duplicate lines.
// Exit codes: 0 no missing companion, 1 at least one missing companion,
// 2 usage error (unreadable file).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getConfig } from '../server/config.mjs'
import { buildSettingsView } from '../server/settings.mjs'

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

// For each Settings feature or integration: the flag that turns it on and the
// settings its `configured` rule needs. Companions ending in _ENABLED must be
// true; the others must be non-empty.
export const COMPANIONS = Object.freeze({
  github: { flag: 'FRIDAY_GITHUB_ENABLED', needs: [] },
  uptime: { flag: 'FRIDAY_MONITORING_UPTIME_ENABLED', needs: ['FRIDAY_MONITORING_ENABLED'] },
  'agent-activity': { flag: 'FRIDAY_AGENT_ACTIVITY_ENABLED', needs: [] },
  approvals: { flag: 'FRIDAY_APPROVALS_ENABLED', needs: ['FRIDAY_MONITORING_ENABLED'] },
  'work-read': { flag: 'FRIDAY_WORK_READ_ENABLED', needs: ['FRIDAY_SUPABASE_URL', 'FRIDAY_WORK_READ_KEY'] },
  'work-write': { flag: 'FRIDAY_WORK_WRITE_ENABLED', needs: ['FRIDAY_WORK_READ_ENABLED', 'FRIDAY_SUPABASE_URL', 'FRIDAY_WORK_READ_KEY', 'FRIDAY_WORK_WRITE_KEY'] },
  // Also needs one free model target; see docs/integrations.md, Free model routing.
  'model-routing': { flag: 'FRIDAY_MODEL_FABRIC_ENABLED', needs: ['FRIDAY_AI_ENABLED'] },
  'web-growth': { flag: 'FRIDAY_WEB_GROWTH_ENABLED', needs: ['FRIDAY_WEB_GROWTH_READER_URL', 'FRIDAY_WEB_GROWTH_READER_TOKEN', 'FRIDAY_WEB_GROWTH_READER_EMAILS'] },
  proxmox: { flag: 'FRIDAY_PROXMOX_ENABLED', needs: ['FRIDAY_PROXMOX_URL', 'FRIDAY_PROXMOX_TOKEN_ID', 'FRIDAY_PROXMOX_TOKEN_SECRET'] },
  'vm100-observer': { flag: 'FRIDAY_VM100_OBSERVER_ENABLED', needs: ['FRIDAY_VM100_OBSERVER_URL', 'FRIDAY_VM100_OBSERVER_TOKEN'] },
  omada: { flag: 'FRIDAY_OMADA_ENABLED', needs: ['FRIDAY_OMADA_URL', 'FRIDAY_OMADA_CONTROLLER_ID', 'FRIDAY_OMADA_CLIENT_ID', 'FRIDAY_OMADA_CLIENT_SECRET'] },
  adguard: { flag: 'FRIDAY_ADGUARD_ENABLED', needs: ['FRIDAY_ADGUARD_URL', 'FRIDAY_ADGUARD_SITE', 'FRIDAY_ADGUARD_USERNAME', 'FRIDAY_ADGUARD_PASSWORD'] },
  prometheus: { flag: 'FRIDAY_PROMETHEUS_ENABLED', needs: ['FRIDAY_PROMETHEUS_URL', 'FRIDAY_PROMETHEUS_SITE', 'FRIDAY_PROMETHEUS_USERNAME', 'FRIDAY_PROMETHEUS_PASSWORD'] },
  'uptime-kuma': { flag: 'FRIDAY_UPTIME_KUMA_ENABLED', needs: ['FRIDAY_UPTIME_KUMA_URL', 'FRIDAY_UPTIME_KUMA_API_KEY', 'FRIDAY_UPTIME_KUMA_SITE'] },
  grafana: { flag: 'FRIDAY_GRAFANA_ENABLED', needs: ['FRIDAY_GRAFANA_URL', 'FRIDAY_GRAFANA_TOKEN', 'FRIDAY_GRAFANA_SITE'] },
  aidesigner: { flag: 'FRIDAY_AIDESIGNER_ENABLED', needs: ['AIDESIGNER_API_KEY'] },
  'agent-registry': { flag: 'FRIDAY_AGENT_REGISTRY_ENABLED', needs: ['FRIDAY_SUPABASE_URL', 'FRIDAY_SUPABASE_SERVICE_KEY'] },
})

// Local Docker always has a socket path, and endpoint checks can also be
// added in the UI, so neither has a companion that .env must provide.
export const UNCHECKED = new Set(['docker', 'endpoints'])

const ESCAPES = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', $: '$' }
// Marks an escaped "$" so substitution leaves it alone; restored afterwards.
const LITERAL_DOLLAR = '\u0000'

// Compose-style substitution from earlier .env lines: ${NAME}, ${NAME:-default},
// ${NAME-default} and $NAME. Names not set earlier resolve to empty, since a
// shell variable cannot be seen offline.
function substitute(value, known) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?)([-?+])([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced, colon, operator, word, bare) => {
      const name = braced || bare
      const set = Object.hasOwn(known, name)
      const current = set ? known[name] : ''
      if (operator === '-') return (colon ? current !== '' : set) ? current : word
      if (operator === '+') return (colon ? current !== '' : set) ? word : ''
      return current
    }).replaceAll(LITERAL_DOLLAR, '$')
}

// Returns the decoded value, or null when a quote is never closed.
function unquote(raw, known) {
  const value = raw.trim()
  const quote = value[0]
  if (quote === "'") {
    const end = value.indexOf("'", 1)
    return end === -1 ? null : value.slice(1, end)
  }
  if (quote === '"') {
    let decoded = ''
    for (let index = 1; index < value.length; index++) {
      const char = value[index]
      if (char === '"') return substitute(decoded, known)
      if (char === '\\' && index + 1 < value.length && Object.hasOwn(ESCAPES, value[index + 1])) {
        const next = value[++index]
        decoded += next === '$' ? LITERAL_DOLLAR : ESCAPES[next]
      } else decoded += char
    }
    return null
  }
  // Unquoted: a " #" starts an inline comment, as in Compose.
  const comment = value.search(/\s#/)
  return substitute((comment === -1 ? value : value.slice(0, comment)).trim(), known)
}

export function parseEnvFile(text) {
  const entries = []
  const malformed = []
  const known = {}
  String(text).split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) return
    const body = line.startsWith('export ') ? line.slice(7).trimStart() : line
    const equals = body.indexOf('=')
    const name = equals === -1 ? '' : body.slice(0, equals).trim()
    const value = equals === -1 || !NAME.test(name) ? null : unquote(body.slice(equals + 1), known)
    if (value === null) malformed.push(index + 1)
    else {
      known[name] = value
      entries.push({ name, value, line: index + 1 })
    }
  })
  return { entries, malformed }
}

// Names Compose interpolates: ${NAME}, ${NAME:-x}, ${NAME?x} and $NAME, but
// not the $$ escape or commented-out lines.
export function composeVariables(text) {
  const names = new Set()
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (rawLine.trimStart().startsWith('#')) continue
    const line = rawLine.replace(/\$\$/g, '')
    for (const match of line.matchAll(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))/g)) names.add(match[1] || match[2])
  }
  return names
}

export function checkEnv({ envText, composeTexts }) {
  const { entries, malformed } = parseEnvFile(envText)
  const passed = new Set()
  for (const text of composeTexts) for (const name of composeVariables(text)) passed.add(name)

  const seen = new Set()
  const duplicates = new Set()
  const env = {}
  for (const { name, value } of entries) {
    if (seen.has(name)) duplicates.add(name)
    seen.add(name)
    // Only what Compose passes through reaches the container.
    if (passed.has(name)) env[name] = value
  }
  const notPassedThrough = [...seen].filter(name => !passed.has(name)).sort()

  const view = buildSettingsView(getConfig(env))
  const missingCompanions = []
  for (const item of [...view.features, ...view.integrations]) {
    if (!item.enabled || item.configured || UNCHECKED.has(item.id)) continue
    const rule = COMPANIONS[item.id]
    const missing = (rule?.needs || []).filter(name => name.endsWith('_ENABLED')
      ? String(env[name] ?? '').toLowerCase() !== 'true'
      : String(env[name] ?? '').trim() === '')
    missingCompanions.push({ id: item.id, name: item.name, flag: rule?.flag || item.id, missing, setup: item.setup || null })
  }
  return { notPassedThrough, missingCompanions, malformed, duplicates: [...duplicates].sort() }
}

export function formatReport(result) {
  const lines = []
  const section = (title, items) => {
    lines.push(`${title}: ${items.length === 0 ? 'none' : ''}`.trimEnd())
    for (const item of items) lines.push(`  - ${item}`)
  }
  section('Set in .env but not passed through by Compose', result.notPassedThrough)
  section('Flags on without their companion settings', result.missingCompanions.map(item => {
    const needs = item.missing.length > 0 ? `needs ${item.missing.join(', ')}` : 'needs more settings'
    return `${item.flag}=true (${item.name}): ${needs}${item.setup ? `; see docs/integrations.md, "${item.setup}"` : ''}`
  }))
  section('Malformed lines', result.malformed.map(line => `line ${line}`))
  section('Set more than once (the last one wins)', result.duplicates)
  lines.push(result.missingCompanions.length > 0 ? 'Result: missing companion settings.' : 'Result: no missing companion settings.')
  return `${lines.join('\n')}\n`
}

function main(argv) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const composeFiles = []
  let envFile = null
  let invalid = false
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--compose' && argv[index + 1]) composeFiles.push(argv[++index])
    else if (!envFile && !argv[index].startsWith('--')) envFile = argv[index]
    else invalid = true
  }
  const usage = 'Usage: node scripts/check-env.mjs <path/to/.env> [--compose compose.yaml]...\n'
  if (!envFile || invalid) {
    process.stderr.write(usage)
    return 2
  }
  if (composeFiles.length === 0) composeFiles.push(join(repoRoot, 'compose.yaml'))
  let envText
  const composeTexts = []
  try {
    envText = readFileSync(envFile, 'utf8')
    for (const file of composeFiles) composeTexts.push(readFileSync(file, 'utf8'))
  } catch {
    process.stderr.write(`check-env: cannot read the .env or Compose file.\n${usage}`)
    return 2
  }
  const result = checkEnv({ envText, composeTexts })
  process.stdout.write(formatReport(result))
  return result.missingCompanions.length > 0 ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
