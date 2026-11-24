import { createAgentActivityLog } from './agents/activity-log.mjs'
import { createApprovalQueue } from './approvals/queue.mjs'
import { createRemediationRunner, loadPlaybooks } from './remediation/fixes.mjs'
import { loadAppLinks } from './applications/app-links.mjs'
import { createDockerExecutorClient, createHomelabActions, createProxmoxPowerClient, loadHomelabCatalog } from './homelab/actions.mjs'
import { createFileAutomationGate } from './security/automation-kill-switch.mjs'
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
      moveEnabled: config.work.write.moveEnabled,
      editEnabled: config.work.write.editEnabled,
    }) : null,
  })
  if (!workReadBridge?.enabled) console.warn('Friday work reads stayed disabled; check Access configuration, the work read key and the grant file')
  else console.log('Friday work reads enabled')
  if (config.work.write.enabled) {
    if (workReadBridge?.canCreateTasks) console.log('Friday new tasks enabled')
    else console.warn('Friday new tasks stayed disabled; check FRIDAY_WORK_WRITE_KEY and that work reads are enabled')
  }
  if (config.work.write.moveEnabled) {
    if (workReadBridge?.canMoveTasks) console.log('Friday task claim and move enabled')
    else console.warn('Friday task claim and move stayed disabled; it also needs FRIDAY_WORK_WRITE_ENABLED and its key')
  }
  if (config.work.write.editEnabled) {
    if (workReadBridge?.canEditTasks) console.log('Friday task editing enabled')
    else console.warn('Friday task editing stayed disabled; it also needs FRIDAY_WORK_WRITE_ENABLED and its key')
  }
}

// Default off. Records which agent answered, with which model and outcome; never prompts or answers.
const agentActivity = config.agentActivity.enabled
  ? await createAgentActivityLog({ path: config.agentActivity.path, limit: config.agentActivity.limit })
  : null

const approvalQueue = config.approvals.enabled
  ? await createApprovalQueue({ path: config.approvals.path, limit: config.approvals.limit })
  : null

// Automated fixes need the approvals queue: a fix only ever follows an approval.
let remediation = null
if (config.remediation.enabled) {
  const playbooks = await loadPlaybooks(config.remediation.playbooksPath)
  if (!approvalQueue) console.warn('Friday automated fixes stayed disabled; they need FRIDAY_APPROVALS_ENABLED')
  else if (!playbooks) console.warn('Friday automated fixes stayed disabled; the playbook file is missing, unsafe or invalid')
  // Real execution needs signed-in operators and the durable action audit.
  else if (config.remediation.mode === 'execute' && (config.mode !== 'live' || !actionAudit))
    console.warn('Friday automated fixes stayed disabled; execute mode needs FRIDAY_MODE=live and FRIDAY_AUDIT_ENABLED=true')
  else {
    remediation = await createRemediationRunner({
      enabled: true,
      mode: config.remediation.mode,
      playbooks,
      path: config.remediation.runsPath,
      executor: { url: config.remediation.executorUrl, token: config.remediation.executorToken },
      // Without a fix executor URL, execute mode uses the homelab Docker executor.
      dockerExecutor: config.homelabActions.executorUrl
        ? createDockerExecutorClient({ url: config.homelabActions.executorUrl, token: config.homelabActions.executorToken })
        : null,
      automationGate: createFileAutomationGate({ filePath: config.remediation.automationGatePath }),
    })
    if (remediation.enabled) console.log(`Friday automated fixes enabled (${remediation.mode}${remediation.executor ? ` via ${remediation.executor}` : ''}, ${playbooks.length} playbooks)`)
    else { console.warn('Friday automated fixes stayed disabled; execute mode needs FRIDAY_HOMELAB_EXECUTOR_URL and _TOKEN (every playbook a container action) or an https FRIDAY_REMEDIATION_EXECUTOR_URL and token'); remediation = null }
  }
}

// Default off. New agents are proposed as GitHub pull requests; the token stays server-side.
if (config.agentProposals.enabled) {
  if (config.agentProposals.token) console.log(`Friday new-agent pull requests enabled (${config.agentProposals.repository})`)
  else console.warn('Friday new-agent pull requests stayed disabled; FRIDAY_AGENT_PROPOSALS_GITHUB_TOKEN is empty')
}

// Default off. Owner-written https links for Open app on Applications.
let appLinks = null
if (config.appLinks.enabled) {
  appLinks = await loadAppLinks(config.appLinks.path)
  if (appLinks) console.log(`Friday Open app links enabled (${appLinks.length} links)`)
  else console.warn('Friday Open app links stayed disabled; the link file is missing, unsafe or invalid')
}

// Default off. Power actions on the Proxmox guests the owner lists, with their own
// scoped token. Dry-run unless execute mode; execute also needs live mode, the
// durable audit and the armed automation gate file.
let homelabActions = null
if (config.homelabActions.enabled) {
  const settings = config.homelabActions
  const catalog = await loadHomelabCatalog(settings.catalogPath)
  if (!catalog) console.warn('Friday homelab changes stayed disabled; the action file is missing, unsafe or invalid')
  else if (settings.mode === 'execute' && (config.mode !== 'live' || !actionAudit))
    console.warn('Friday homelab changes stayed disabled; execute mode needs FRIDAY_MODE=live and FRIDAY_AUDIT_ENABLED=true')
  else {
    homelabActions = await createHomelabActions({
      enabled: true,
      mode: settings.mode,
      catalog,
      path: settings.runsPath,
      client: createProxmoxPowerClient({ baseUrl: settings.proxmoxUrl, tokenId: settings.proxmoxTokenId,
        tokenSecret: settings.proxmoxTokenSecret, rejectUnauthorized: settings.rejectUnauthorized }),
      dockerClient: createDockerExecutorClient({ url: settings.executorUrl, token: settings.executorToken }),
      automationGate: createFileAutomationGate({ filePath: settings.automationGatePath }),
    })
    if (homelabActions.enabled) console.log(`Friday homelab changes enabled (${homelabActions.mode}, ${catalog.length} guests and containers)`)
    else { console.warn('Friday homelab changes stayed disabled; each Proxmox guest needs the FRIDAY_HOMELAB_PROXMOX_* token and each container needs FRIDAY_HOMELAB_EXECUTOR_URL and a 32+ character FRIDAY_HOMELAB_EXECUTOR_TOKEN'); homelabActions = null }
  }
}

const server = createFridayServer({ config, monitoringRuntime, agentRegistryService, agentService, repositoryRegistry, actionAudit, siteSettings, endpointChecks, repositorySettings, pushSubscriptions, workReadBridge, agentActivity, approvalQueue, remediation, appLinks, homelabActions })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})

if (config.automation.enabled) {
  const automation = createAutomationServer({ config, monitoringRuntime })
  automation.listen(config.automation.port, '0.0.0.0', () => {
    console.log(`Friday read-only automation listening on port ${config.automation.port}`)
  })
}
