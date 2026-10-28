// Read-only projection of the server's effective configuration for operators.
// Reports posture only: enabled flags, whether required fields are present and
// whether credentials exist. Never secrets, identities, URLs or addresses.
const AI_PROVIDERS = ['groq', 'gemini', 'ollama', 'openai', 'anthropic']

const present = value => typeof value === 'string' && value.trim() !== ''

function credentials(...values) {
  return values.every(present) ? 'present' : 'missing'
}

function auditPosture(config, actionAudit) {
  const enabled = config.audit?.enabled === true
  const status = enabled && actionAudit ? actionAudit.status() : null
  return {
    enabled,
    integrity: status ? status.integrity : (enabled ? 'unavailable' : null),
    events: Number.isSafeInteger(status?.events) ? status.events : null,
  }
}

function integration(id, name, section, {configured, credentials: creds, site = null, tls = null}) {
  return {id, name, enabled: section?.enabled === true, configured, credentials: creds, site: present(site) ? site : null, tls}
}

export function buildSettingsView(config, {actionAudit = null} = {}) {
  const {proxmox = {}, vm100Observer = {}, docker = {}, endpoints = {}, omada = {}, adguard = {}, prometheus = {}, uptimeKuma = {}} = config
  const registry = config.agents?.registry || {}
  const endpointChecks = (endpoints.checks?.length || 0) + (endpoints.urls?.length || 0)
  const access = config.access || {}
  const ai = config.ai || {}
  const order = Array.isArray(ai.providerOrder) ? ai.providerOrder : []

  return {
    mode: config.mode === 'live' ? 'live' : 'mock',
    access: {
      originVerification: access.enabled === true || (config.mode === 'live' && access.enabled !== false),
      configured: present(access.teamDomain) && present(access.audience),
      operators: Array.isArray(access.operatorEmails) ? access.operatorEmails.length : 0,
    },
    integrations: [
      integration('proxmox', 'Proxmox VE', proxmox, {
        configured: present(proxmox.baseUrl) && present(proxmox.tokenId) && present(proxmox.tokenSecret),
        credentials: credentials(proxmox.tokenId, proxmox.tokenSecret),
        tls: proxmox.rejectUnauthorized === false ? 'unverified' : 'verified',
      }),
      integration('vm100-observer', 'VM100 Docker observer', vm100Observer, {
        configured: present(vm100Observer.baseUrl) && present(vm100Observer.token), credentials: credentials(vm100Observer.token),
      }),
      integration('docker', 'Local Docker (VM102)', docker, {configured: present(docker.socketPath), credentials: 'not-required'}),
      {...integration('endpoints', 'HTTP endpoint checks', endpoints, {
        configured: !endpoints.configurationError && endpointChecks > 0, credentials: 'not-required',
      }), checks: endpointChecks, error: endpoints.configurationError || null},
      integration('omada', 'Omada controller', omada, {
        configured: present(omada.baseUrl) && present(omada.controllerId) && present(omada.clientId) && present(omada.clientSecret),
        credentials: credentials(omada.clientId, omada.clientSecret),
      }),
      integration('adguard', 'AdGuard Home', adguard, {
        configured: present(adguard.baseUrl) && present(adguard.site) && present(adguard.username) && present(adguard.password),
        credentials: credentials(adguard.username, adguard.password), site: adguard.site,
      }),
      integration('prometheus', 'Prometheus', prometheus, {
        configured: present(prometheus.baseUrl) && present(prometheus.site) && present(prometheus.username) && present(prometheus.password),
        credentials: credentials(prometheus.username, prometheus.password), site: prometheus.site,
      }),
      integration('uptime-kuma', 'Uptime Kuma', uptimeKuma, {
        configured: present(uptimeKuma.baseUrl) && present(uptimeKuma.apiKey) && present(uptimeKuma.site),
        credentials: credentials(uptimeKuma.apiKey), site: uptimeKuma.site,
      }),
      integration('agent-registry', 'Local agent registry (Supabase)', registry, {
        configured: present(registry.supabaseUrl) && present(registry.supabaseServiceKey), credentials: credentials(registry.supabaseServiceKey),
      }),
    ],
    ai: {
      enabled: ai.enabled === true,
      providerOrder: [...order],
      providers: AI_PROVIDERS.map(id => {
        const provider = ai.providers?.[id] || {}
        const entry = {id, inOrder: order.includes(id),
          credentials: id === 'ollama' ? 'not-required' : credentials(provider.apiKey),
          model: present(provider.model) ? provider.model : null}
        return id === 'ollama' ? {...entry, enabled: provider.enabled === true} : entry
      }),
      cloudTimeoutMs: ai.cloudTimeoutMs ?? null,
      localTimeoutMs: ai.localTimeoutMs ?? null,
    },
    monitoring: {
      enabled: config.monitoring?.enabled === true,
      pollSeconds: config.monitoring?.pollSeconds ?? null,
      offlineGraceSeconds: config.monitoring?.offlineGraceSeconds ?? null,
      historyLimit: config.monitoring?.historyLimit ?? null,
      diagnostics: config.diagnostics?.enabled === true,
    },
    automationApi: {
      enabled: config.automation?.enabled === true,
      port: config.automation?.port ?? null,
      serviceTokens: Array.isArray(config.automation?.access?.serviceTokenIds) ? config.automation.access.serviceTokenIds.length : 0,
      readOnly: true,
    },
    audit: auditPosture(config, actionAudit),
    // Fixed facts about this build, not toggles.
    safety: {writableSettings: false, infrastructureActions: false, executor: false},
  }
}
