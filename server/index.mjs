import { createAgentActivityLog } from './agents/activity-log.mjs'
import { createApprovalQueue } from './approvals/queue.mjs'
import { fileURLToPath } from 'node:url'
import { getConfig } from './config.mjs'
import { createFridayServer } from './http.mjs'
import { createAutomationServer } from './automation.mjs'
import { buildOverview } from './overview.mjs'
import { applySiteSettings, createSiteSettingsStore } from './site-settings.mjs'
import { createNtfyNotifier } from './notifications/ntfy.mjs'
import { applyEndpointChecks, createEndpointCheckStore } from './endpoint-checks.mjs'
import { createPushSubscriptionStore, createWebPushNotifier } from './notifications/web-push.mjs'
import { createSupabaseWorkReadRepository } from './work/read-only-repository.mjs'
import { createWorkService } from './work/work-service.mjs'
import { createMemoryService } from './work/memory-service.mjs'
import { createTrustedWorkReadBridge } from './work/file-subject-grants.mjs'
import { createSupabaseTaskInsertRepository } from './work/task-insert-repository.mjs'
import { createMonitoringRuntime } from './monitoring/runtime.mjs'
import { createFileMonitoringStore } from './monitoring/store.mjs'
import { createSupabaseRegistryClient } from './agents/supabase-client.mjs'
import { createAgentRegistryService } from './agents/registry-service.mjs'
import { syncAgentRegistry } from './agents/registry-sync.mjs'
import { createAgentService } from './agents/agent-service.mjs'
import { createRepositorySettingsStore, ManagedRepositoryRegistry } from './repositories/managed-registry.mjs'
import { createActionAudit } from './audit/action-audit.mjs'

const config = getConfig()
if (config.automation.enabled && (!Number.isInteger(config.automation.port) ||
    config.automation.port < 1 || config.automation.port > 65535 || config.automation.port === config.port)) {
  throw new Error('Automation port must be valid and separate from the UI port')
}
const notifier = createNtfyNotifier(config.notifications.ntfy)
if (config.notifications.ntfy.url && !notifier) console.warn('Friday notifications: FRIDAY_NTFY_URL must be an https topic URL; notifications disabled')
const pushSubscriptions = await createPushSubscriptionStore({ path: config.pushSubscriptions.path })
const webPush = createWebPushNotifier({ keys: config.notifications.webPush, store: pushSubscriptions })
const notifiers = [notifier, webPush].filter(Boolean)
const siteSettings = await createSiteSettingsStore({ path: config.siteSettings.path })
const endpointChecks = await createEndpointCheckStore({ path: config.endpointChecks.path })
const store = createFileMonitoringStore({ statePath: config.monitoring.statePath })
const monitoringRuntime = createMonitoringRuntime({
  config,
  collectOverview: (effectiveConfig) =>
    buildOverview(applyEndpointChecks(applySiteSettings(effectiveConfig, siteSettings.get()), endpointChecks.get())),
  notifyIncidents: notifiers.length
    ? (changes) => Promise.all(notifiers.map((channel) => channel.notify(changes).catch(() => {})))
    : null,
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

const repositorySettings = await createRepositorySettingsStore({
  path: config.repositories.settingsPath, allowedRoots: config.repositories.allowedRoots,
})
const repositoryRegistry = new ManagedRepositoryRegistry({ registryPath: config.repositories.registryPath, store: repositorySettings })
// Default off. Reads use a SELECT-only database role and per-person project grants.
let workReadBridge = null
if (config.work.enabled) {
  const repository = createSupabaseWorkReadRepository({
    baseUrl: config.agents.registry.supabaseUrl,
    readKey: config.work.readKey,
    gatewayKey: config.work.gatewayKey,
  })
  // Grants are re-read, re-validated and expiry-checked on every request, so a
  // revoked person or project stops being readable without restarting Friday.
  workReadBridge = createTrustedWorkReadBridge({
    enabled: true,
    grantFilePath: config.work.grantsPath,
    access: config.access,
    workService: createWorkService({ repository }),
    memoryService: createMemoryService({ repository }),
    // Default off. Insert-only role; operators with a project grant can add a 'ready' task.
    taskWriter: config.work.write.enabled ? createSupabaseTaskInsertRepository({
      baseUrl: config.agents.registry.supabaseUrl,
      writeKey: config.work.write.key,
      gatewayKey: config.work.gatewayKey,
    }) : null,
  })
  if (!workReadBridge?.enabled) console.warn('Friday work reads stayed disabled; check Access configuration, the work read key and the grant file')
  else console.log('Friday work reads enabled')
  if (config.work.write.enabled) {
    if (workReadBridge?.canCreateTasks) console.log('Friday new tasks enabled')
    else console.warn('Friday new tasks stayed disabled; check FRIDAY_WORK_WRITE_KEY and that work reads are enabled')
  }
}

// Default off. Records which agent answered, with which model and outcome; never prompts or answers.
const agentActivity = config.agentActivity.enabled
  ? await createAgentActivityLog({ path: config.agentActivity.path, limit: config.agentActivity.limit })
  : null

const approvalQueue = config.approvals.enabled
  ? await createApprovalQueue({ path: config.approvals.path, limit: config.approvals.limit })
  : null

const server = createFridayServer({ config, monitoringRuntime, agentRegistryService, agentService, repositoryRegistry, actionAudit, siteSettings, endpointChecks, repositorySettings, pushSubscriptions, workReadBridge, agentActivity, approvalQueue })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})

if (config.automation.enabled) {
  const automation = createAutomationServer({ config, monitoringRuntime })
  automation.listen(config.automation.port, '0.0.0.0', () => {
    console.log(`Friday read-only automation listening on port ${config.automation.port}`)
  })
}
