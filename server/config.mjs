const DEFAULT_AI_PROVIDER_ORDER = ['groq', 'gemini', 'ollama']
const AI_PROVIDER_IDS = new Set(['groq', 'gemini', 'ollama', 'openai', 'anthropic'])

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

function localAgentProfile(env, prefix, fallbackModel = 'qwen3:4b-instruct') {
  return {
    provider: 'ollama',
    baseUrl: env[`FRIDAY_AGENT_${prefix}_URL`] || 'http://192.168.1.70:11434',
    model: env[`FRIDAY_AGENT_${prefix}_MODEL`] || fallbackModel,
    context: positiveNumber(env[`FRIDAY_AGENT_${prefix}_CONTEXT`] ?? env.FRIDAY_AGENT_MODEL_CONTEXT, 8192),
    maxTokens: positiveNumber(env[`FRIDAY_AGENT_${prefix}_MAX_TOKENS`] ?? env.FRIDAY_AGENT_MODEL_MAX_TOKENS, 768),
  }
}

export function getConfig(env = process.env) {
  const legacyAiTimeoutProvided = String(env.FRIDAY_AI_REQUEST_TIMEOUT_MS ?? '').trim() !== ''
  const legacyAiTimeoutMs = positiveNumber(env.FRIDAY_AI_REQUEST_TIMEOUT_MS, 20000)
  const cloudTimeoutFallback = legacyAiTimeoutProvided ? legacyAiTimeoutMs : 15000
  const localTimeoutFallback = legacyAiTimeoutProvided ? legacyAiTimeoutMs : 45000

  return {
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
      urls: String(env.FRIDAY_ENDPOINT_URLS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    },
    monitoring: {
      enabled: enabled(env.FRIDAY_MONITORING_ENABLED),
      pollSeconds: positiveNumber(env.FRIDAY_MONITORING_POLL_SECONDS, 30),
      offlineGraceSeconds: positiveNumber(env.FRIDAY_MONITORING_OFFLINE_GRACE_SECONDS, 300),
      statePath: env.FRIDAY_MONITORING_STATE_PATH || '/data/monitoring-state.json',
      historyLimit: positiveNumber(env.FRIDAY_MONITORING_HISTORY_LIMIT, 2000),
    },
    diagnostics: {
      enabled: enabled(env.FRIDAY_DIAGNOSTICS_ENABLED),
    },
    agents: {
      enabled: enabled(env.FRIDAY_AGENT_REGISTRY_ENABLED),
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
