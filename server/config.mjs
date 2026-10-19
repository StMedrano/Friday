const DEFAULT_AI_PROVIDER_ORDER = ['groq', 'gemini', 'ollama']
const AI_PROVIDER_IDS = new Set(['groq', 'gemini', 'ollama', 'openai', 'anthropic'])
const ENDPOINT_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const ENDPOINT_FIELDS = new Set(['id', 'name', 'site', 'url', 'expectedStatuses'])

function enabled(value) {
  return String(value ?? '').toLowerCase() === 'true'
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function providerOrder(value) {
  const seen = new Set()
  const parsed = String(value || DEFAULT_AI_PROVIDER_ORDER.join(','))
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => AI_PROVIDER_IDS.has(item))
    .filter((item) => {
      if (seen.has(item)) return false
      seen.add(item)
      return true
    })
  return parsed.length ? parsed : [...DEFAULT_AI_PROVIDER_ORDER]
}

function endpointUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return parsed.toString()
  } catch { return null }
}

function endpointText(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && text.length <= 80 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null
}

function endpointConfiguration(env) {
  const raw = String(env.FRIDAY_ENDPOINT_CHECKS_JSON || '').trim()
  const legacyRaw = String(env.FRIDAY_ENDPOINT_URLS || '').trim()
  const invalid = () => ({ checks: [], urls: [], configurationError: 'invalid-endpoint-configuration' })
  if (raw && legacyRaw) return invalid()
  if (!raw) {
    const urls = legacyRaw ? legacyRaw.split(',').map(item => item.trim()).filter(Boolean) : []
    if (urls.length > 16 || urls.some(value => !endpointUrl(value))) return invalid()
    return { checks: [], urls, configurationError: null }
  }
  if (raw.length > 16384) return invalid()
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 16) return invalid()
    const ids = new Set()
    const checks = parsed.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !ENDPOINT_FIELDS.has(key))) throw Error('invalid')
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = endpointText(item.name)
      const site = endpointText(item.site)
      const url = endpointUrl(item.url)
      const expectedStatuses = item.expectedStatuses === undefined ? [200] : item.expectedStatuses
      if (!ENDPOINT_ID.test(id) || ids.has(id) || !name || !site || !url || !Array.isArray(expectedStatuses) ||
        expectedStatuses.length < 1 || expectedStatuses.length > 10 ||
        expectedStatuses.some(status => !Number.isInteger(status) || status < 100 || status > 599) ||
        new Set(expectedStatuses).size !== expectedStatuses.length) throw Error('invalid')
      ids.add(id)
      return { id, name, site, url, expectedStatuses: [...expectedStatuses] }
    })
    return { checks, urls: [], configurationError: null }
  } catch { return invalid() }
}

function localAgentProfile(env, prefix, fallbackModel = 'qwen3:4b-instruct') {
  return {
    provider: 'ollama',
    // Verified CT108 nic1 endpoint on vmbr1 / VLAN 10.
    baseUrl: env[`FRIDAY_AGENT_${prefix}_URL`] || 'http://10.1.10.12:11434',
    model: env[`FRIDAY_AGENT_${prefix}_MODEL`] || fallbackModel,
    context: positiveNumber(env[`FRIDAY_AGENT_${prefix}_CONTEXT`] ?? env.FRIDAY_AGENT_MODEL_CONTEXT, 8192),
    maxTokens: positiveNumber(env[`FRIDAY_AGENT_${prefix}_MAX_TOKENS`] ?? env.FRIDAY_AGENT_MODEL_MAX_TOKENS, 768),
    timeoutMs: Math.ceil(positiveNumber(env[`FRIDAY_AGENT_${prefix}_TIMEOUT_MS`], prefix === 'LOCAL_ROUTER' ? 15000 : 90000)),
  }
}

export function getConfig(env = process.env) {
  const legacyAiTimeoutProvided = String(env.FRIDAY_AI_REQUEST_TIMEOUT_MS ?? '').trim() !== ''
  const legacyAiTimeoutMs = positiveNumber(env.FRIDAY_AI_REQUEST_TIMEOUT_MS, 20000)
  const cloudTimeoutFallback = legacyAiTimeoutProvided ? legacyAiTimeoutMs : 15000
  const localTimeoutFallback = legacyAiTimeoutProvided ? legacyAiTimeoutMs : 45000
  const agentRegistryEnabled = enabled(env.FRIDAY_AGENT_REGISTRY_ENABLED)
  const endpoints = endpointConfiguration(env)

  return {
    access: {
      // Live deployments MUST validate an Access JWT at the origin.
      enabled: env.FRIDAY_MODE === 'live',
      teamDomain: env.FRIDAY_ACCESS_TEAM_DOMAIN || '',
      audience: env.FRIDAY_ACCESS_AUD || '',
      operatorEmails: String(env.FRIDAY_ACCESS_OPERATOR_EMAILS || '').split(',').map(x=>x.trim()).filter(Boolean),
    },
    port: Number(env.FRIDAY_PORT || 3010),
    mode: env.FRIDAY_MODE === 'live' ? 'live' : 'mock',
    docker: {
      enabled: enabled(env.FRIDAY_DOCKER_ENABLED),
      socketPath: env.FRIDAY_DOCKER_SOCKET || '/var/run/docker.sock',
      hostName: env.FRIDAY_DOCKER_HOST_NAME || 'VM 102',
    },
    proxmox: {
      enabled: enabled(env.FRIDAY_PROXMOX_ENABLED),
      baseUrl: env.FRIDAY_PROXMOX_URL || '',
      tokenId: env.FRIDAY_PROXMOX_TOKEN_ID || '',
      tokenSecret: env.FRIDAY_PROXMOX_TOKEN_SECRET || '',
      rejectUnauthorized: !enabled(env.FRIDAY_PROXMOX_INSECURE),
    },
    vm100Observer: {
      enabled: enabled(env.FRIDAY_VM100_OBSERVER_ENABLED),
      baseUrl: env.FRIDAY_VM100_OBSERVER_URL || '',
      token: env.FRIDAY_VM100_OBSERVER_TOKEN || '',
      hostName: env.FRIDAY_VM100_OBSERVER_HOST_NAME || 'VM 100',
    },
    endpoints: {
      enabled: enabled(env.FRIDAY_ENDPOINTS_ENABLED),
      ...endpoints,
    },
    monitoring: {
      enabled: enabled(env.FRIDAY_MONITORING_ENABLED),
      pollSeconds: positiveNumber(env.FRIDAY_MONITORING_POLL_SECONDS, 30),
      offlineGraceSeconds: positiveNumber(env.FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS, 300),
      statePath: env.FRIDAY_MONITORING_STATE_PATH || '/data/monitoring-state.json',
      historyLimit: positiveNumber(env.FRIDAY_MONITORING_HISTORY_LIMIT, 2000),
    },
    repositories: { registryPath: env.FRIDAY_REPOSITORY_REGISTRY_PATH || './repositories.json' },
    diagnostics: {
      enabled: enabled(env.FRIDAY_DIAGNOSTICS_ENABLED),
    },
    agents: {
      enabled: agentRegistryEnabled,
      registry: {
        enabled: agentRegistryEnabled,
        supabaseUrl: env.FRIDAY_SUPABASE_URL || '',
        supabaseServiceKey: env.FRIDAY_SUPABASE_SERVICE_KEY || '',
      },
      modelProfiles: {
        'local-router': localAgentProfile(env, 'LOCAL_ROUTER'),
        'local-general': localAgentProfile(env, 'LOCAL_GENERAL'),
        'local-coder': localAgentProfile(env, 'LOCAL_CODER'),
      },
    },
    ai: {
      enabled: enabled(env.FRIDAY_AI_ENABLED),
      providerOrder: providerOrder(env.FRIDAY_AI_PROVIDER_ORDER),
      timeoutMs: legacyAiTimeoutMs,
      cloudTimeoutMs: positiveNumber(env.FRIDAY_CLOUD_AI_TIMEOUT_MS, cloudTimeoutFallback),
      localTimeoutMs: positiveNumber(env.FRIDAY_LOCAL_AI_TIMEOUT_MS, localTimeoutFallback),
      providers: {
        groq: {
          apiKey: env.GROQ_API_KEY || '',
          model: env.GROQ_MODEL || '',
        },
        gemini: {
          apiKey: env.GEMINI_API_KEY || '',
          model: env.GEMINI_MODEL || '',
        },
        ollama: {
          enabled: enabled(env.FRIDAY_LOCAL_AI_ENABLED),
          baseUrl: env.FRIDAY_LOCAL_AI_URL || 'http://ollama:11434',
          model: env.FRIDAY_LOCAL_AI_MODEL || 'qwen3:4b-instruct',
          context: positiveNumber(env.FRIDAY_LOCAL_AI_CONTEXT, 8192),
          maxTokens: positiveNumber(env.FRIDAY_LOCAL_AI_MAX_TOKENS, 512),
        },
        openai: {
          apiKey: env.OPENAI_API_KEY || '',
          model: env.OPENAI_MODEL || 'gpt-5.6-terra',
        },
        anthropic: {
          apiKey: env.ANTHROPIC_API_KEY || '',
          model: env.ANTHROPIC_MODEL || '',
        },
      },
    },
  }
}
