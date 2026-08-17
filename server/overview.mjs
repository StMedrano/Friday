import { integrationSummary, normalizeOverview } from './core.mjs'
import { getMockOverview } from './adapters/mock.mjs'
import { getDockerServices } from './adapters/docker.mjs'
import { getProxmoxServices } from './adapters/proxmox.mjs'
import { getEndpointServices } from './adapters/endpoints.mjs'

async function safe(label, fn) {
  try {
    return { items: await fn(), error: null }
  } catch (error) {
    return { items: [], error: `${label}: ${error.message}` }
  }
}

export async function buildOverview(config) {
  const mock = getMockOverview()
  if (config.mode !== 'live') {
    return { ...normalizeOverview(mock), integrations: integrationSummary({}) }
  }

  const docker = await safe('docker', () => getDockerServices(config.docker))
  const proxmox = await safe('proxmox', () => getProxmoxServices(config.proxmox))
  const endpoints = await safe('endpoints', () => getEndpointServices(config.endpoints))
  const liveServices = [...docker.items, ...proxmox.items, ...endpoints.items]
  const errors = [docker.error, proxmox.error, endpoints.error].filter(Boolean)

  return {
    ...normalizeOverview({
      ...mock,
      mode: 'live',
      services: liveServices.length ? liveServices : mock.services,
      alerts: [
        ...(liveServices.length ? [] : mock.alerts),
        ...errors.map((message, index) => ({ id: `integration-${index}`, title: 'Integration degraded', detail: message, severity: 'warning', source: 'Friday' })),
      ],
    }),
    integrations: integrationSummary({
      docker: config.docker.enabled,
      proxmox: config.proxmox.enabled,
      endpoints: config.endpoints.enabled,
    }),
  }
}
