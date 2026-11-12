import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkEnv, composeVariables, formatReport, parseEnvFile, COMPANIONS, UNCHECKED } from './check-env.mjs'
import { getConfig } from '../server/config.mjs'
import { buildSettingsView } from '../server/settings.mjs'

const script = fileURLToPath(new URL('./check-env.mjs', import.meta.url))
const repoCompose = readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8')

// Fake secrets: none of these may ever appear in the script's output.
const SECRETS = {
  proxmoxId: 'fake-proxmox-token-id-7Q2',
  workRead: 'fake-work-read-key-K9x',
  unknown: 'fake-unpassed-secret-Zz4',
  malformed: 'fake-malformed-secret-Mm1',
  quoted: 'fake quoted secret Qq8',
  duplicate: 'fake-duplicate-secret-Dd3',
  hidden: 'fake-hidden-companion-Hh5',
}

function tempFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), 'friday-env-check-'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

test('parses compose-style .env lines and reports malformed lines by number only', () => {
  const parsed = parseEnvFile([
    '# comment',
    '',
    'FRIDAY_MODE=live',
    'export FRIDAY_AI_ENABLED=true',
    `GROQ_API_KEY="${SECRETS.quoted}"`,
    "GEMINI_MODEL='gemini # not a comment'",
    'FRIDAY_UI_PORT=3010 # inline comment',
    SECRETS.malformed,
    `1BAD_NAME=${SECRETS.malformed}`,
    `OPENAI_API_KEY="${SECRETS.malformed}`,
  ].join('\n'))
  assert.deepEqual(parsed.entries.map(entry => [entry.name, entry.value, entry.line]), [
    ['FRIDAY_MODE', 'live', 3],
    ['FRIDAY_AI_ENABLED', 'true', 4],
    ['GROQ_API_KEY', SECRETS.quoted, 5],
    ['GEMINI_MODEL', 'gemini # not a comment', 6],
    ['FRIDAY_UI_PORT', '3010', 7],
  ])
  assert.deepEqual(parsed.malformed, [8, 9, 10])
})

test('collects every variable compose.yaml interpolates', () => {
  const names = composeVariables('services:\n  a:\n    ports:\n      - "${PORT:-1}:1"\n    environment:\n      A: ${A:-}\n      B: $B\n      C: "$${NOT_A_VAR}"\n      # D: ${COMMENTED}\n      E: ${E:?required}\n')
  assert.deepEqual([...names].sort(), ['A', 'B', 'E', 'PORT'])
  const real = composeVariables(repoCompose)
  for (const name of ['FRIDAY_UI_PORT', 'FRIDAY_WORK_WRITE_KEY', 'AIDESIGNER_API_KEY', 'FRIDAY_SERVICE_TOKEN_EXPIRES_AT']) assert.ok(real.has(name), name)
})

test('lists .env variables that compose.yaml does not pass through', () => {
  const result = checkEnv({ envText: `FRIDAY_MODE=live\nFRIDAY_BRAND_NEW_KEY=${SECRETS.unknown}\n`, composeTexts: [repoCompose] })
  assert.deepEqual(result.notPassedThrough, ['FRIDAY_BRAND_NEW_KEY'])
  assert.deepEqual(result.missingCompanions, [])
})

test('reports a flag that is on without its companion settings', () => {
  const result = checkEnv({
    envText: [
      'FRIDAY_WORK_WRITE_ENABLED=true',
      'FRIDAY_PROXMOX_ENABLED=true',
      'FRIDAY_PROXMOX_URL=https://pve.invalid:8006',
      `FRIDAY_PROXMOX_TOKEN_ID=${SECRETS.proxmoxId}`,
      'FRIDAY_APPROVALS_ENABLED=true',
    ].join('\n'),
    composeTexts: [repoCompose],
  })
  assert.deepEqual(result.missingCompanions.map(item => [item.flag, item.missing]), [
    ['FRIDAY_APPROVALS_ENABLED', ['FRIDAY_MONITORING_ENABLED']],
    ['FRIDAY_WORK_WRITE_ENABLED', ['FRIDAY_WORK_READ_ENABLED', 'FRIDAY_SUPABASE_URL', 'FRIDAY_WORK_READ_KEY', 'FRIDAY_WORK_WRITE_KEY']],
    ['FRIDAY_PROXMOX_ENABLED', ['FRIDAY_PROXMOX_TOKEN_SECRET']],
  ])
  assert.equal(result.missingCompanions[1].setup, 'New tasks (Tasks write path)')
})

test('a companion set in .env but not passed through by compose counts as missing', () => {
  const compose = 'services:\n  friday:\n    environment:\n      FRIDAY_AIDESIGNER_ENABLED: ${FRIDAY_AIDESIGNER_ENABLED:-false}\n'
  const result = checkEnv({ envText: `FRIDAY_AIDESIGNER_ENABLED=true\nAIDESIGNER_API_KEY=${SECRETS.hidden}\n`, composeTexts: [compose] })
  assert.deepEqual(result.notPassedThrough, ['AIDESIGNER_API_KEY'])
  assert.deepEqual(result.missingCompanions.map(item => [item.flag, item.missing]), [['FRIDAY_AIDESIGNER_ENABLED', ['AIDESIGNER_API_KEY']]])
})

test('complete and disabled settings produce no companion findings', () => {
  const result = checkEnv({
    envText: [
      'FRIDAY_MONITORING_ENABLED=true',
      'FRIDAY_APPROVALS_ENABLED=true',
      'FRIDAY_MONITORING_UPTIME_ENABLED=true',
      'FRIDAY_GITHUB_ENABLED=true',
      'FRIDAY_WORK_READ_ENABLED=true',
      'FRIDAY_SUPABASE_URL=https://supabase.invalid',
      `FRIDAY_WORK_READ_KEY=${SECRETS.workRead}`,
      'FRIDAY_WEB_GROWTH_ENABLED=false',
    ].join('\n'),
    composeTexts: [repoCompose],
  })
  assert.deepEqual(result.missingCompanions, [])
  assert.deepEqual(result.notPassedThrough, [])
  assert.deepEqual(result.malformed, [])
})

test('reports duplicate names once each', () => {
  const result = checkEnv({ envText: `GROQ_API_KEY=${SECRETS.duplicate}\nGROQ_API_KEY=${SECRETS.duplicate}2\n`, composeTexts: [repoCompose] })
  assert.deepEqual(result.duplicates, ['GROQ_API_KEY'])
})

test('every Settings feature and integration has a companion rule or is deliberately unchecked', () => {
  const view = buildSettingsView(getConfig({}))
  for (const item of [...view.features, ...view.integrations]) {
    assert.ok(COMPANIONS[item.id] || UNCHECKED.has(item.id), `no companion rule for ${item.id}`)
  }
  for (const id of Object.keys(COMPANIONS)) {
    assert.ok([...view.features, ...view.integrations].some(item => item.id === id), `stale companion rule ${id}`)
  }
})

test('report and CLI print names only, never values, and exit non-zero only on a missing companion', () => {
  const envText = [
    `FRIDAY_BRAND_NEW_KEY=${SECRETS.unknown}`,
    SECRETS.malformed,
    `GROQ_API_KEY="${SECRETS.quoted}"`,
    `GROQ_API_KEY=${SECRETS.duplicate}`,
    'FRIDAY_PROXMOX_ENABLED=true',
    `FRIDAY_PROXMOX_TOKEN_ID=${SECRETS.proxmoxId}`,
    `FRIDAY_WORK_READ_KEY=${SECRETS.workRead}`,
  ].join('\n')
  const dir = tempFiles({ '.env': envText, 'ok.env': `FRIDAY_UNUSED=${SECRETS.unknown}\n${SECRETS.malformed}\n`, 'compose.yaml': repoCompose })

  const failing = run([join(dir, '.env'), '--compose', join(dir, 'compose.yaml')])
  assert.equal(failing.status, 1)
  assert.match(failing.output, /FRIDAY_BRAND_NEW_KEY/)
  assert.match(failing.output, /line 2/)
  assert.match(failing.output, /FRIDAY_PROXMOX_ENABLED/)
  assert.match(failing.output, /FRIDAY_PROXMOX_TOKEN_SECRET/)
  assert.match(failing.output, /GROQ_API_KEY/)

  const passing = run([join(dir, 'ok.env'), '--compose', join(dir, 'compose.yaml')])
  assert.equal(passing.status, 0)
  assert.match(passing.output, /FRIDAY_UNUSED/)

  const report = formatReport(checkEnv({ envText, composeTexts: [repoCompose] }))
  for (const output of [failing.output, passing.output, report]) {
    for (const secret of Object.values(SECRETS)) assert.ok(!output.includes(secret), 'a value leaked into the output')
    assert.ok(!output.includes('pve.invalid'))
  }
})

test('CLI refuses a missing .env path with a usage error', () => {
  const result = run([join(tmpdir(), 'friday-env-check-does-not-exist.env')])
  assert.equal(result.status, 2)
  assert.match(result.output, /Usage|cannot read/i)
})
