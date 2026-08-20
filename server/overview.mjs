import { integrationSummary, normalizeOverview } from './core.mjs'
import { getMockOverview } from './adapters/mock.mjs'
import { getDockerServices as defaultGetDockerServices } from './adapters/docker.mjs'
import { getProxmoxServices as defaultGetProxmoxServices } from './adapters/proxmox.mjs'
import { getVm100ObserverServices as defaultGetVm100ObserverServices } from './adapters/vm100-observer.mjs'
import { getEndpointServices as defaultGetEndpointServices } from './adapters/endpoints.mjs'

async function safe(label, fn) {
  try {
    return { items: await fn(), error: null }
  } catch (error) {
    return { items: [], error: `${label}: ${error.message}` }
  }
}

export function decorateOverviewWithMonitoring(overview, { incidents = [], summary = null } = {}) {
  const incidentAlerts = incidents
    .filter((incident) => incident?.status === 'open')
    .map((incident) => ({
      id: `incident-${incident.id}`,
      title: String(incident.title || 'Monitoring incident'),
      detail: String(incident.detail || ''),
      severity: incident.severity || 'warning',
      source: 'monitoring',
    }))

  return {
    ...overview,
    alerts: [...(overview.alerts || []).map((alert) => ({ ...alert })), ...incidentAlerts],
    incidents: incidents.map((incident) => ({ ...incident })),
    monitoring: summary ? { ...summary } : null,
  }
}

export async function buildOverview(config, adapters = {}) {
  const getDockerServices = adapters.getDockerServices || defaultGetDockerServices
  const getProxmoxServices = adapters.getProxmoxServices || defaultGetProxmoxServices
  const getVm100ObserverServices = adapters.getVm100ObserverServices || defaultGetVm100ObserverServices
  const getEndpointServices = adapters.getEndpointServices || defaultGetEndpointServices

  const mock = getMockOverview()
  if (config.mode !== 'live') {
    return { ...normalizeOverview(mock), integrations: integrationSummary({}) }
  }

  const docker = await safe('docker', () => getDockerServices(config.docker))
  const proxmox = await safe('proxmox', () => getProxmoxServices(config.proxmox))
  const vm100Observer = await safe('vm100-observer', () => getVm100ObserverServices(config.vm100Observer))
  const endpoints = await safe('endpoints', () => getEndpointServices(config.endpoints))
  const liveServices = [...docker.items, ...proxmox.items, ...vm100Observer.items, ...endpoints.items]
  const errors = [docker.error, proxmox.error, vm100Observer.error, endpoints.error].filter(Boolean)

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
      vm100Observer: config.vm100Observer.enabled,
      endpoints: config.endpoints.enabled,
    }),
  }
}
