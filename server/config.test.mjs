import test from 'node:test'
import assert from 'node:assert/strict'
import { getConfig } from './config.mjs'

test('Uptime Kuma defaults off with a server-only metrics key and explicit site', () => {
  assert.deepEqual(getConfig({}).uptimeKuma, { enabled: false, baseUrl: '', apiKey: '', site: '' })
  assert.deepEqual(getConfig({ FRIDAY_UPTIME_KUMA_ENABLED: 'true', FRIDAY_UPTIME_KUMA_URL: 'https://kuma.test', FRIDAY_UPTIME_KUMA_API_KEY: 'key', FRIDAY_UPTIME_KUMA_SITE: 'Site B' }).uptimeKuma,
    { enabled: true, baseUrl: 'https://kuma.test', apiKey: 'key', site: 'Site B' })
})

test('Prometheus defaults off with empty server-only settings and explicit fallback site', () => {
  assert.deepEqual(getConfig({}).prometheus, { enabled: false, baseUrl: '', username: '', password: '', site: '' })
  assert.deepEqual(getConfig({ FRIDAY_PROMETHEUS_ENABLED: 'true', FRIDAY_PROMETHEUS_URL: 'https://prom.test', FRIDAY_PROMETHEUS_USERNAME: 'reader', FRIDAY_PROMETHEUS_PASSWORD: 'secret', FRIDAY_PROMETHEUS_SITE: 'Site A' }).prometheus,
    { enabled: true, baseUrl: 'https://prom.test', username: 'reader', password: 'secret', site: 'Site A' })
})

test('AdGuard defaults off with empty server-only configuration and explicit site assignment', () => {
  assert.deepEqual(getConfig({}).adguard, { enabled: false, baseUrl: '', username: '', password: '', site: '' })
  assert.deepEqual(getConfig({ FRIDAY_ADGUARD_ENABLED: 'true', FRIDAY_ADGUARD_URL: 'https://dns.test', FRIDAY_ADGUARD_USERNAME: 'reader', FRIDAY_ADGUARD_PASSWORD: 'secret', FRIDAY_ADGUARD_SITE: 'Site B' }).adguard,
    { enabled: true, baseUrl: 'https://dns.test', username: 'reader', password: 'secret', site: 'Site B' })
})

test('Omada defaults off with server-only client credentials', () => {
  assert.deepEqual(getConfig({}).omada, { enabled: false, baseUrl: '', controllerId: '', clientId: '', clientSecret: '' })
  assert.deepEqual(getConfig({ FRIDAY_OMADA_ENABLED: 'true', FRIDAY_OMADA_URL: 'https://omada.test', FRIDAY_OMADA_CONTROLLER_ID: 'controller', FRIDAY_OMADA_CLIENT_ID: 'client', FRIDAY_OMADA_CLIENT_SECRET: 'secret' }).omada,
    { enabled: true, baseUrl: 'https://omada.test', controllerId: 'controller', clientId: 'client', clientSecret: 'secret' })
})

test('repository registry defaults to a server-side path and accepts explicit configuration', () => {
  assert.deepEqual(getConfig({}).repositories, {
    registryPath: './repositories.json', allowedRoots: ['/repositories'], settingsPath: '/data/repository-settings.json',
  })
  assert.deepEqual(getConfig({
    FRIDAY_REPOSITORY_REGISTRY_PATH: '/data/repositories.json', FRIDAY_REPOSITORY_ROOTS: '/repositories, /srv/git, relative',
    FRIDAY_REPOSITORY_SETTINGS_PATH: '/data/repo-settings.json',
  }).repositories, {
    registryPath: '/data/repositories.json', allowedRoots: ['/repositories', '/srv/git'], settingsPath: '/data/repo-settings.json',
  })
})

test('AI config exposes the Groq Gemini Ollama chain and keeps credentials server-side', () => {
  const config = getConfig({
    FRIDAY_AI_ENABLED: 'true',
    FRIDAY_AI_PROVIDER_ORDER: 'groq,gemini,ollama',
    FRIDAY_CLOUD_AI_TIMEOUT_MS: '15000',
    FRIDAY_LOCAL_AI_TIMEOUT_MS: '30000',
    GROQ_API_KEY: 'groq-secret',
    GROQ_MODEL: 'groq-model',
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODEL: 'gemini-model',
    FRIDAY_LOCAL_AI_ENABLED: 'true',
    FRIDAY_LOCAL_AI_URL: 'http://192.168.1.70:11434',
    FRIDAY_LOCAL_AI_MODEL: 'qwen3:4b-instruct',
    FRIDAY_LOCAL_AI_CONTEXT: '8192',
    FRIDAY_LOCAL_AI_MAX_TOKENS: '512',
  })

  assert.equal(config.ai.enabled, true)
  assert.deepEqual(config.ai.providerOrder, ['groq', 'gemini', 'ollama'])
  assert.equal(config.ai.cloudTimeoutMs, 15000)
  assert.equal(config.ai.localTimeoutMs, 30000)
  assert.deepEqual(config.ai.providers.groq, { apiKey: 'groq-secret', model: 'groq-model' })
  assert.deepEqual(config.ai.providers.gemini, { apiKey: 'gemini-secret', model: 'gemini-model' })
  assert.deepEqual(config.ai.providers.ollama, {
    enabled: true,
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 512,
  })
})

test('AI provider order drops unknown and duplicate provider ids while retaining optional legacy adapters', () => {
  const config = getConfig({ FRIDAY_AI_PROVIDER_ORDER: 'gemini,unknown,groq,gemini,openai' })
  assert.deepEqual(config.ai.providerOrder, ['gemini', 'groq', 'openai'])
})

test('cloud providers require explicit models while OpenAI keeps its legacy default', () => {
  const config = getConfig({})
  assert.equal(config.ai.enabled, false)
  assert.equal(config.ai.providers.groq.model, '')
  assert.equal(config.ai.providers.gemini.model, '')
  assert.equal(config.ai.providers.openai.model, 'gpt-5.6-terra')
  assert.equal(config.ai.providers.anthropic.model, '')
  assert.equal(config.ai.providers.ollama.enabled, false)
  assert.equal(config.ai.providers.ollama.model, 'qwen3:4b-instruct')
  assert.equal(config.ai.providers.ollama.context, 8192)
  assert.equal(config.ai.providers.ollama.maxTokens, 512)
})

test('agent model profiles stay local-only and server-side', () => {
  const config = getConfig({
    FRIDAY_AGENT_REGISTRY_ENABLED: 'true',
    FRIDAY_AGENT_LOCAL_GENERAL_URL: 'http://192.168.1.70:11434',
    FRIDAY_AGENT_LOCAL_GENERAL_MODEL: 'qwen3:4b-instruct',
    FRIDAY_AGENT_LOCAL_GENERAL_CONTEXT: '8192',
    FRIDAY_AGENT_LOCAL_GENERAL_MAX_TOKENS: '768',
  })

  assert.equal(config.agents.enabled, true)
  assert.deepEqual(config.agents.modelProfiles['local-general'], {
    provider: 'ollama',
    baseUrl: 'http://192.168.1.70:11434',
    model: 'qwen3:4b-instruct',
    context: 8192,
    maxTokens: 768,
    timeoutMs: 90000,
  })
  assert.equal('apiKey' in config.agents.modelProfiles['local-general'], false)
})

test('agent registry Supabase config is disabled by default and server-only', () => {
  const defaults = getConfig({})
  assert.deepEqual(defaults.agents.registry, {
    enabled: false,
    supabaseUrl: '',
    supabaseServiceKey: '',
  })

  const config = getConfig({
    FRIDAY_AGENT_REGISTRY_ENABLED: 'true',
    FRIDAY_SUPABASE_URL: 'http://192.168.1.80:8000',
    FRIDAY_SUPABASE_SERVICE_KEY: 'registry-secret',
  })
  assert.deepEqual(config.agents.registry, {
    enabled: true,
    supabaseUrl: 'http://192.168.1.80:8000',
    supabaseServiceKey: 'registry-secret',
  })
})

test('VM100 observer config is disabled by default and stays server-side', () => {
  const defaults = getConfig({})
  assert.equal(defaults.vm100Observer.enabled, false)
  assert.equal(defaults.vm100Observer.baseUrl, '')
  assert.equal(defaults.vm100Observer.token, '')
  assert.equal(defaults.vm100Observer.hostName, 'VM 100')

  const config = getConfig({
    FRIDAY_VM100_OBSERVER_ENABLED: 'true',
    FRIDAY_VM100_OBSERVER_URL: 'http://192.168.1.124:3199',
    FRIDAY_VM100_OBSERVER_TOKEN: 'observer-secret',
    FRIDAY_VM100_OBSERVER_HOST_NAME: 'VM 100',
  })
  assert.equal(config.vm100Observer.enabled, true)
  assert.equal(config.vm100Observer.baseUrl, 'http://192.168.1.124:3199')
  assert.equal(config.vm100Observer.token, 'observer-secret')
  assert.equal(config.vm100Observer.hostName, 'VM 100')
})

test('endpoint checks parse bounded structured server-only definitions',()=>{
 const checks=[
  {id:'site-a-friday',name:'Friday',site:'Site A',url:'https://friday.example.test/healthz',expectedStatuses:[200]},
  {id:'site-b-edge',name:'Remote edge',site:'Site B',url:'https://remote.example.test/status',expectedStatuses:[204,302]},
 ]
 const config=getConfig({FRIDAY_ENDPOINTS_ENABLED:'true',FRIDAY_ENDPOINT_CHECKS_JSON:JSON.stringify(checks)})
 assert.deepEqual(config.endpoints,{enabled:true,site:'Site A',checks,urls:[],configurationError:null})
})

test('endpoint checks reject duplicate ids, credentials, queries, fragments, invalid protocols and malformed JSON',()=>{
 const valid={id:'site-a',name:'Site A',site:'Site A',url:'https://site-a.example.test/healthz',expectedStatuses:[200]}
 const invalidValues=[
  '{not-json',
  JSON.stringify([valid,{...valid,url:'https://site-b.example.test/healthz'}]),
  JSON.stringify([{...valid,url:'https://user:pass@site-a.example.test/healthz'}]),
  JSON.stringify([{...valid,url:'https://site-a.example.test/healthz?token=value'}]),
  JSON.stringify([{...valid,url:'https://site-a.example.test/healthz#fragment'}]),
  JSON.stringify([{...valid,url:'file:///etc/passwd'}]),
  JSON.stringify([{...valid,expectedStatuses:[99]}]),
 ]
 for(const value of invalidValues){
  const endpoints=getConfig({FRIDAY_ENDPOINTS_ENABLED:'true',FRIDAY_ENDPOINT_CHECKS_JSON:value}).endpoints
  assert.deepEqual(endpoints.checks,[])
  assert.equal(endpoints.configurationError,'invalid-endpoint-configuration')
 }
})

test('endpoint checks cap definitions at sixteen and preserve legacy URL configuration',()=>{
 const checks=Array.from({length:17},(_,index)=>({
  id:`check-${index}`,name:`Check ${index}`,site:index%2?'Site B':'Site A',
  url:`https://service-${index}.example.test/healthz`,expectedStatuses:[200],
 }))
 assert.equal(getConfig({FRIDAY_ENDPOINT_CHECKS_JSON:JSON.stringify(checks)}).endpoints.configurationError,'invalid-endpoint-configuration')
 assert.deepEqual(getConfig({FRIDAY_ENDPOINT_URLS:'https://one.example.test/health, https://two.example.test/status'}).endpoints,{
  enabled:false,site:'Site A',checks:[],urls:['https://one.example.test/health','https://two.example.test/status'],configurationError:null,
 })
})

test('diagnostics are disabled by default and require explicit opt-in', () => {
  assert.deepEqual(getConfig({}).diagnostics, { enabled: false })
  assert.deepEqual(getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'true' }).diagnostics, { enabled: true })
  assert.deepEqual(getConfig({ FRIDAY_DIAGNOSTICS_ENABLED: 'false' }).diagnostics, { enabled: false })
})

test('live Friday always requires Access JWT verification with server-only settings',()=>{
 const live=getConfig({FRIDAY_MODE:'live',FRIDAY_ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com',FRIDAY_ACCESS_AUD:'aud-123',FRIDAY_ACCESS_OPERATOR_EMAILS:'operator@example.test'})
 assert.deepEqual(live.access,{enabled:true,teamDomain:'https://team.cloudflareaccess.com',audience:'aud-123',operatorEmails:['operator@example.test']})
 assert.equal(getConfig({FRIDAY_MODE:'live',FRIDAY_ACCESS_REQUIRED:'false'}).access.enabled,true)
 assert.equal(getConfig({FRIDAY_MODE:'mock'}).access.enabled,false)
})
