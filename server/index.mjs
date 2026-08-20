import { getConfig } from './config.mjs'
import { createFridayServer } from './http.mjs'
import { buildOverview } from './overview.mjs'
import { createMonitoringRuntime } from './monitoring/runtime.mjs'
import { createFileMonitoringStore } from './monitoring/store.mjs'

const config = getConfig()
const store = createFileMonitoringStore({ statePath: config.monitoring.statePath })
const monitoringRuntime = createMonitoringRuntime({
  config,
  collectOverview: buildOverview,
  store,
})

await monitoringRuntime.start()

const server = createFridayServer({ config, monitoringRuntime })
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Friday listening on 0.0.0.0:${config.port} (${config.mode} mode)`)
})
