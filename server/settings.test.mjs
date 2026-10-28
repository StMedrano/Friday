import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {getConfig} from './config.mjs'
import {buildSettingsView} from './settings.mjs'
import {createFridayServer} from './http.mjs'

const SECRET_ENV = {
  FRIDAY_PROXMOX_TOKEN_ID: 'secret-proxmox-id', FRIDAY_PROXMOX_TOKEN_SECRET: 'secret-proxmox-value',
  FRIDAY_VM100_OBSERVER_TOKEN: 'secret-observer', FRIDAY_OMADA_CLIENT_ID: 'secret-omada-id',
  FRIDAY_OMADA_CLIENT_SECRET: 'secret-omada-value', FRIDAY_ADGUARD_USERNAME: 'secret-adguard-user',
  FRIDAY_ADGUARD_PASSWORD: 'secret-adguard-pass', FRIDAY_PROMETHEUS_USERNAME: 'secret-prom-user',
  FRIDAY_PROMETHEUS_PASSWORD: 'secret-prom-pass', FRIDAY_UPTIME_KUMA_API_KEY: 'secret-kuma',
  FRIDAY_SUPABASE_SERVICE_KEY: 'secret-supabase', GROQ_API_KEY: 'secret-groq', GEMINI_API_KEY: 'secret-gemini',
  OPENAI_API_KEY: 'secret-openai', ANTHROPIC_API_KEY: 'secret-anthropic',
  FRIDAY_ACCESS_OPERATOR_EMAILS: 'secret-operator@example.com', FRIDAY_ACCESS_AUD: 'secret-audience-tag',
  FRIDAY_AUTOMATION_SERVICE_TOKEN_IDS: 'secret-token.access',
}
const URL_ENV = {
  FRIDAY_PROXMOX_URL: 'https://10.9.9.1:8006', FRIDAY_VM100_OBSERVER_URL: 'http://10.9.9.2:3199',
  FRIDAY_OMADA_URL: 'https://10.9.9.3', FRIDAY_ADGUARD_URL: 'https://10.9.9.4', FRIDAY_PROMETHEUS_URL: 'https://10.9.9.5',
  FRIDAY_UPTIME_KUMA_URL: 'https://10.9.9.6', FRIDAY_SUPABASE_URL: 'https://10.9.9.7', FRIDAY_LOCAL_AI_URL: 'http://10.9.9.8:11434',
  FRIDAY_ACCESS_TEAM_DOMAIN: 'https://secretteam.cloudflareaccess.com',
  FRIDAY_ENDPOINT_CHECKS_JSON: JSON.stringify([{id: 'portal', name: 'Portal', site: 'Site A', url: 'https://10.9.9.9/health'}]),
}

test('settings view never contains secrets, identities or internal URLs', () => {
  const config = getConfig({FRIDAY_MODE: 'live', ...SECRET_ENV, ...URL_ENV})
  const serialized = JSON.stringify(buildSettingsView(config))
  for (const value of Object.values(SECRET_ENV)) assert.ok(!serialized.includes(value.split(',')[0]), value)
  assert.ok(!serialized.includes('10.9.9.'), 'internal addresses must not be exposed')
  assert.ok(!serialized.includes('secretteam'))
})

test('reports integration posture as enabled/configured/credential presence', () => {
  const view = buildSettingsView(getConfig({
    FRIDAY_PROXMOX_ENABLED: 'true', FRIDAY_PROXMOX_URL: 'https://pve:8006', FRIDAY_PROXMOX_TOKEN_ID: 'id', FRIDAY_PROXMOX_INSECURE: 'true',
    FRIDAY_ADGUARD_ENABLED: 'true', FRIDAY_ADGUARD_URL: 'https://dns', FRIDAY_ADGUARD_SITE: 'Site A',
    FRIDAY_ENDPOINTS_ENABLED: 'true', FRIDAY_ENDPOINT_URLS: 'https://a,https://b',
  }))
  const byId = Object.fromEntries(view.integrations.map(item => [item.id, item]))
  assert.deepEqual(byId.proxmox, {id: 'proxmox', name: 'Proxmox VE', enabled: true, configured: false, credentials: 'missing', site: null, tls: 'unverified'})
  // The AdGuard and Prometheus adapters require Basic credentials.
  assert.deepEqual(byId.adguard, {id: 'adguard', name: 'AdGuard Home', enabled: true, configured: false, credentials: 'missing', site: 'Site A', tls: null})
  assert.equal(byId.endpoints.configured, true)
  assert.equal(byId.endpoints.checks, 2)
  assert.equal(byId.docker.credentials, 'not-required')
  assert.equal(byId['uptime-kuma'].enabled, false)
  assert.deepEqual(view.integrations.map(item => item.id), ['proxmox', 'vm100-observer', 'docker', 'endpoints', 'omada', 'adguard', 'prometheus', 'uptime-kuma', 'agent-registry'])
})

test('AdGuard and Prometheus are configured only with URL, site and both credentials', () => {
  const view = buildSettingsView(getConfig({
    FRIDAY_ADGUARD_URL: 'https://dns', FRIDAY_ADGUARD_SITE: 'Site A', FRIDAY_ADGUARD_USERNAME: 'u', FRIDAY_ADGUARD_PASSWORD: 'p',
    FRIDAY_PROMETHEUS_URL: 'https://prom', FRIDAY_PROMETHEUS_SITE: 'Site B', FRIDAY_PROMETHEUS_USERNAME: 'u',
  }))
  const byId = Object.fromEntries(view.integrations.map(item => [item.id, item]))
  assert.deepEqual([byId.adguard.configured, byId.adguard.credentials], [true, 'present'])
  assert.deepEqual([byId.prometheus.configured, byId.prometheus.credentials], [false, 'missing'])
})

test('reports AI provider order, credential presence and timeouts', () => {
  const view = buildSettingsView(getConfig({FRIDAY_AI_ENABLED: 'true', GROQ_API_KEY: 'k', GROQ_MODEL: 'llama', FRIDAY_LOCAL_AI_ENABLED: 'true'}))
  assert.equal(view.ai.enabled, true)
  assert.deepEqual(view.ai.providerOrder, ['groq', 'gemini', 'ollama'])
  const providers = Object.fromEntries(view.ai.providers.map(item => [item.id, item]))
  assert.deepEqual(providers.groq, {id: 'groq', inOrder: true, credentials: 'present', model: 'llama'})
  assert.deepEqual(providers.gemini, {id: 'gemini', inOrder: true, credentials: 'missing', model: null})
  assert.deepEqual(providers.ollama, {id: 'ollama', inOrder: true, credentials: 'not-required', model: 'qwen3:4b-instruct', enabled: true})
  assert.equal(providers.openai.inOrder, false)
  assert.deepEqual({cloud: view.ai.cloudTimeoutMs, local: view.ai.localTimeoutMs}, {cloud: 15000, local: 45000})
})

test('reports access, monitoring, automation API and fixed safety posture', () => {
  const view = buildSettingsView(getConfig({
    FRIDAY_MODE: 'live', FRIDAY_ACCESS_TEAM_DOMAIN: 'https://t.cloudflareaccess.com', FRIDAY_ACCESS_AUD: 'aud',
    FRIDAY_ACCESS_OPERATOR_EMAILS: 'a@example.com,b@example.com', FRIDAY_MONITORING_ENABLED: 'true',
    FRIDAY_AUTOMATION_ENABLED: 'true', FRIDAY_AUTOMATION_SERVICE_TOKEN_IDS: 'x.access',
  }))
  assert.equal(view.mode, 'live')
  assert.deepEqual(view.access, {originVerification: true, configured: true, operators: 2})
  assert.deepEqual(view.monitoring, {enabled: true, pollSeconds: 30, offlineGraceSeconds: 300, historyLimit: 2000, diagnostics: false})
  assert.deepEqual(view.automationApi, {enabled: true, port: 3011, serviceTokens: 1, readOnly: true})
  assert.deepEqual(view.safety, {writableSettings: false, infrastructureActions: false, executor: false})
  assert.equal(buildSettingsView(getConfig({})).access.originVerification, false)
})

async function withServer(options, fn) {
  const server = createFridayServer(options)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { return await fn('http://127.0.0.1:' + server.address().port) }
  finally { server.close(); await once(server, 'close') }
}

test('GET /api/settings is read-only and behind verified identity', async () => {
  const config = getConfig({FRIDAY_MODE: 'live', ...SECRET_ENV})
  let gateCalls = 0
  const accessGateImpl = async () => { gateCalls++; return {status: 200, identity: {subject: 'viewer'}} }
  await withServer({config, accessGateImpl}, async base => {
    const response = await fetch(base + '/api/settings')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.safety.writableSettings, false)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      assert.equal((await fetch(base + '/api/settings', {method, headers: {'content-type': 'application/json'}, body: '{}'})).status, 404, method)
  })
  assert.ok(gateCalls >= 1)
  await withServer({config, accessGateImpl: async () => ({status: 403})}, async base => {
    assert.equal((await fetch(base + '/api/settings')).status, 403)
  })
})
