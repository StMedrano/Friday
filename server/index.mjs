import { fileURLToPath } from 'node:url'
import { getConfig } from './config.mjs'
import { createFridayServer } from './http.mjs'
import { createAutomationServer } from './automation.mjs'
import { buildOverview } from './overview.mjs'
import { applySiteSettings, createSiteSettingsStore } from './site-settings.mjs'
import { createNtfyNotifier } from './notifications/ntfy.mjs'
import { createMonitoringRuntime } from './monitoring/runtime.mjs'
import { createFileMonitoringStore } from './monitoring/store.mjs'
import { createSupabaseRegistryClient } from './agents/supabase-client.mjs'
import { createAgentRegistryService } from './agents/registry-service.mjs'
import { syncAgentRegistry } from './agents/registry-sync.mjs'
import { createAgentService } from './agents/agent-service.mjs'
import { LocalRepositoryRegistry } from './repositories/repository.mjs'
import { createActionAudit } from './audit/action-audit.mjs'

const config = getConfig()
if (config.automation.enabled && (!Number.isInteger(config.automation.port) ||
    config.automation.port < 1 || config.automation.port > 65535 || config.automation.port === config.port)) {
  throw new Error('Automation port must be valid and separate from the UI port')
}
const notifier = createNtfyNotifier(config.notifications.ntfy)
if (config.notifications.ntfy.url && !notifier) console.warn('Friday notifications: FRIDAY_NTFY_URL must be an https topic URL; notifications disabled')
const siteSettings = await createSiteSettingsStore({ path: config.siteSettings.path })
const store = createFileMonitoringStore({ statePath: config.monitoring.statePath })
const monitoringRuntime = createMonitoringRuntime({
  config,
  collectOverview: (effectiveConfig) => buildOverview(applySiteSettings(effectiveConfig, siteSettings.get())),
  notifyIncidents: notifier ? (changes) => notifier.notify(changes) : null,
  store,
})

await monitoringRuntime.start()

let agentRegistryService = null
let agentService = null
if (config.agents.registry.enabled) {
  const registryClient = createSupabaseRegistryClient({
    baseUrl: config.agents.registry.supabaseUrl,
    serviceKey: config.agents.registry.supabaseServiceKey,
  })
  agentRegistryService = createAgentRegistryService({
    registryClient,
    syncImpl: syncAgentRegistry,
    syncContext: {
      agentsDir: fileURLToPath(new URL('../agents/', import.meta.url)),
      sourceCommit: process.env.FRIDAY_SOURCE_COMMIT || '',
      modelProfiles: config.agents.modelProfiles,
    },
  })
  agentService = createAgentService({
    registryService: agentRegistryService,
    config,
  })

  try {
    await agentRegistryService.sync()
  } catch {
    console.warn('Friday agent registry startup sync unavailable; continuing without agent registry readiness')
  }
}

// When enabled but unusable, audited actions are refused rather than run unaudited.
let actionAudit = null
if (config.audit.enabled) {
  try {
    actionAudit = await createActionAudit({ directory: config.audit.directory, maxBytes: config.audit.maxBytes })
    if (actionAudit.status().integrity !== 'verified') console.warn('Friday action audit integrity check failed; audited actions are refused')
  } catch {
    console.warn('Friday action audit unavailable; audited actions are refused')
    const unavailable = async () => { throw new Error('audit-unavailable') }
    actionAudit = Object.freeze({ record: unavailable, list: unavailable, status: () => ({ integrity: 'unavailable' }) })
  }
}

const repositoryRegistry = new LocalRepositoryRegistry({ registryPath: config.repositories.registryPath })
const server = createFridayServer({ config, monitoringRuntime, agentRegistryService, agentService, repositoryRegistry, actionAudit, siteSettings })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})

if (config.automation.enabled) {
  const automation = createAutomationServer({ config, monitoringRuntime })
  automation.listen(config.automation.port, '0.0.0.0', () => {
    console.log(`Friday read-only automation listening on port ${config.automation.port}`)
  })
}
