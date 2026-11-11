import {ntfyTopicUrl} from './notifications/ntfy.mjs'
import {vapidKeys} from './notifications/web-push.mjs'
import {buildModelTargets} from './ai/model-registry.mjs'
import {rankEligibleModelTargets} from './ai/model-router.mjs'

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

const DAY_MS = 24 * 60 * 60 * 1000
export const SERVICE_TOKEN_WARNING_DAYS = 14

// Whole calendar days (UTC) from today to the configured expiry date.
function serviceTokenExpiry(config, now) {
  const expiresAt = config.serviceToken?.expiresAt
  if (!present(expiresAt) || !Number.isFinite(now)) return null
  const expiry = Date.parse(`${expiresAt}T00:00:00Z`)
  if (!Number.isFinite(expiry)) return null
  const today = new Date(now)
  const daysRemaining = Math.round((expiry - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY_MS)
  const state = daysRemaining < 0 ? 'expired' : daysRemaining <= SERVICE_TOKEN_WARNING_DAYS ? 'warning' : 'ok'
  return {expiresAt, daysRemaining, state}
}

function integration(id, name, section, {configured, credentials: creds, site = null, tls = null}) {
  return {id, name, enabled: section?.enabled === true, configured, credentials: creds, site: present(site) ? site : null, tls}
}

function feature(id, name, enabled, configured, setup) {
  return {id, name, enabled: enabled === true, configured: configured === true, setup}
}

// Opt-in features added after the first integrations list. `configured` says
// whether the settings each one needs alongside its flag are present; `setup`
// names the docs/integrations.md section that explains how to turn it on.
function featureView(config) {
  const work = config.work || {}
  const supabaseUrl = config.agents?.registry?.supabaseUrl
  const workRead = present(supabaseUrl) && present(work.readKey)
  const webGrowth = config.webGrowth || {}
  // Count only targets the router would try: enabled, free-class, and (when
  // hosted) with the API key the NVIDIA provider requires.
  let modelTargets = 0
  try {
    const fabric = config.modelFabric || {}
    modelTargets = rankEligibleModelTargets({targets: buildModelTargets(fabric), requirements: {capabilities: []}, policy: fabric.policy})
      .filter(target => target.descriptor.deployment !== 'hosted' || present(target.providerConfig.apiKey)).length
  } catch { modelTargets = 0 }
  return [
    // The token is optional: public repositories can be read without one.
    feature('github', 'GitHub pull requests and CI', config.github?.enabled, true, 'GitHub pull requests, CI and last commit'),
    feature('uptime', 'Uptime history', config.monitoring?.uptimeEnabled, config.monitoring?.enabled === true, 'Uptime history'),
    feature('agent-activity', 'Agent activity log', config.agentActivity?.enabled, true, 'Agent activity log'),
    // Proposals come from open monitoring incidents; without monitoring the routes answer 503.
    feature('approvals', 'Approvals queue', config.approvals?.enabled, config.monitoring?.enabled === true, 'Approvals queue'),
    feature('work-read', 'Project tasks', work.enabled, workRead, 'Project tasks (read)'),
    feature('work-write', 'New tasks', work.write?.enabled, work.enabled === true && workRead && present(work.write?.key), 'New tasks (Tasks write path)'),
    feature('model-routing', 'Free model routing for chat', config.modelFabric?.enabled, config.ai?.enabled === true && modelTargets > 0, 'Free model routing'),
    feature('web-growth', 'Web Growth leads', webGrowth.enabled,
      present(webGrowth.baseUrl) && present(webGrowth.token) && Array.isArray(webGrowth.readerEmails) && webGrowth.readerEmails.length > 0, 'Web Growth leads'),
  ]
}

export function buildSettingsView(config, {actionAudit = null, now = Date.now()} = {}) {
  const {proxmox = {}, vm100Observer = {}, docker = {}, endpoints = {}, omada = {}, adguard = {}, prometheus = {}, uptimeKuma = {}, grafana = {}} = config
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
      integration('grafana', 'Grafana', grafana, {
        configured: present(grafana.baseUrl) && present(grafana.token) && present(grafana.site),
        credentials: credentials(grafana.token), site: grafana.site,
      }),
      integration('aidesigner', 'AIDesigner', config.aidesigner, {
        configured: present(config.aidesigner?.apiKey), credentials: credentials(config.aidesigner?.apiKey),
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
    notifications: {
      ntfy: Boolean(ntfyTopicUrl(config.notifications?.ntfy?.url)),
      webPush: Boolean(vapidKeys(config.notifications?.webPush)),
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
    features: featureView(config),
    serviceToken: serviceTokenExpiry(config, now),
    audit: auditPosture(config, actionAudit),
    // Fixed facts about this build, not toggles.
    safety: {writableSettings: false, infrastructureActions: false, executor: false},
  }
}
