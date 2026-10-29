import { integrationSummary, normalizeOverview } from './core.mjs'
import { deriveSites } from './site-settings.mjs'
import { getMockOverview } from './adapters/mock.mjs'
import { getDockerServices as defaultGetDockerServices } from './adapters/docker.mjs'
import { getProxmoxServices as defaultGetProxmoxServices } from './adapters/proxmox.mjs'
import { getVm100ObserverServices as defaultGetVm100ObserverServices } from './adapters/vm100-observer.mjs'
import { getEndpointServices as defaultGetEndpointServices } from './adapters/endpoints.mjs'
import { getOmadaServices as defaultGetOmadaServices } from './adapters/omada.mjs'
import { getAdguardServices as defaultGetAdguardServices } from './adapters/adguard.mjs'
import { getPrometheusServices as defaultGetPrometheusServices } from './adapters/prometheus.mjs'
import { getSupabaseHealthServices as defaultGetSupabaseHealthServices } from './adapters/supabase-health.mjs'
import { getUptimeKumaServices as defaultGetUptimeKumaServices } from './adapters/uptime-kuma.mjs'
import { getGrafanaServices as defaultGetGrafanaServices } from './adapters/grafana.mjs'

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
  const getOmadaServices = adapters.getOmadaServices || defaultGetOmadaServices
  const getAdguardServices = adapters.getAdguardServices || defaultGetAdguardServices
  const getPrometheusServices = adapters.getPrometheusServices || defaultGetPrometheusServices
  const getUptimeKumaServices = adapters.getUptimeKumaServices || defaultGetUptimeKumaServices
  const getGrafanaServices = adapters.getGrafanaServices || defaultGetGrafanaServices
  const getSupabaseHealthServices = adapters.getSupabaseHealthServices || defaultGetSupabaseHealthServices

  if (config.mode !== 'live') {
    return { ...normalizeOverview(getMockOverview()), integrations: integrationSummary({}) }
  }

  const docker = await safe('docker', () => getDockerServices(config.docker))
  const proxmox = await safe('proxmox', () => getProxmoxServices(config.proxmox))
  const vm100Observer = await safe('vm100-observer', () => getVm100ObserverServices(config.vm100Observer))
  const endpoints = await safe('endpoints', () => getEndpointServices(config.endpoints))
  const omada = await safe('omada', () => getOmadaServices(config.omada))
  const adguard = await safe('adguard', () => getAdguardServices(config.adguard))
  const prometheus = await safe('prometheus', () => getPrometheusServices(config.prometheus))
  const uptimeKuma = await safe('uptime-kuma', () => getUptimeKumaServices(config.uptimeKuma))
  const grafana = await safe('grafana', () => getGrafanaServices(config.grafana))
  const supabase = await safe('supabase', () => getSupabaseHealthServices(config.supabaseHealth))
  const liveServices = [...docker.items, ...proxmox.items, ...vm100Observer.items, ...endpoints.items, ...omada.items, ...adguard.items, ...prometheus.items, ...uptimeKuma.items, ...grafana.items, ...supabase.items]
  const errors = [docker.error, proxmox.error, vm100Observer.error, endpoints.error, omada.error, adguard.error, prometheus.error, uptimeKuma.error, grafana.error, supabase.error].filter(Boolean)

  return {
    ...normalizeOverview({
      mode: 'live',
      // Missing live telemetry stays unavailable; sample data is for mock mode only.
      sites: deriveSites(config.declaredSites, liveServices),
      services: liveServices,
      alerts: errors.map((message, index) => ({ id: `integration-${index}`, title: 'Integration degraded', detail: message, severity: 'warning', source: 'Friday' })),
    }),
    integrations: integrationSummary({
      docker: config.docker.enabled,
      proxmox: config.proxmox.enabled,
      vm100Observer: config.vm100Observer.enabled,
      endpoints: config.endpoints.enabled,
      omada: config.omada?.enabled,
      adguard: config.adguard?.enabled,
      prometheus: config.prometheus?.enabled,
      uptimeKuma: config.uptimeKuma?.enabled,
      grafana: config.grafana?.enabled,
      supabase: config.supabaseHealth?.enabled,
    }),
  }
}
