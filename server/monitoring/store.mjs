import * as fs from 'node:fs/promises'
import { dirname } from 'node:path'
import { createEmptyMonitoringState } from './state.mjs'

export function createFileMonitoringStore({ statePath, fsImpl = fs }) {
  if (!statePath) throw new Error('Monitoring state path is required')

  return {
    async load() {
      let raw
      try {
        raw = await fsImpl.readFile(statePath, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return createEmptyMonitoringState()
        throw error
      }

      try {
        return JSON.parse(raw)
      } catch {
        const corruptPath = `${statePath}.corrupt-${Date.now()}`
        await fsImpl.rename(statePath, corruptPath).catch(() => {})
        return createEmptyMonitoringState()
      }
    },

    async save(state) {
      await fsImpl.mkdir(dirname(statePath), { recursive: true })
      const tempPath = `${statePath}.tmp-${process.pid}-${Date.now()}`
      const payload = `${JSON.stringify(state, null, 2)}\n`
      await fsImpl.writeFile(tempPath, payload, { mode: 0o600 })
      await fsImpl.rename(tempPath, statePath)
    },
  }
}
