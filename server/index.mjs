import { getConfig } from './config.mjs'
import { createFridayServer } from './http.mjs'
import { buildOverview } from './overview.mjs'
import { createMonitoringRuntime } from './monitoring/runtime.mjs'
import { createFileMonitoringStore } from './monitoring/store.mjs'
import { LocalAgentRepository } from './agents/repository.mjs'
import { LocalRepositoryRegistry } from './repositories/repository.mjs'

const config = getConfig()
const store = createFileMonitoringStore({ statePath: config.monitoring.statePath })
const monitoringRuntime = createMonitoringRuntime({
  config,
  collectOverview: buildOverview,
  store,
})
const agentRepository = new LocalAgentRepository({ directory: process.env.FRIDAY_AGENT_LOCAL_DIR || './agents' })
const repositoryRegistry = new LocalRepositoryRegistry({
  registryPath: process.env.FRIDAY_REPOSITORY_REGISTRY_PATH || './repositories.json',
})

await monitoringRuntime.start()

const server = createFridayServer({ config, monitoringRuntime, agentRepository, repositoryRegistry })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})
