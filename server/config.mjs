function enabled(value) {
  return String(value ?? '').toLowerCase() === 'true'
}

function positiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getConfig(env = process.env) {
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
    ai: {
      enabled: enabled(env.FRIDAY_AI_ENABLED),
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-5.6-terra',
    },
  }
}
