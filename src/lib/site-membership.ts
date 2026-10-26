import type { Service, Site } from './infrastructure'
import type { FridayIncident } from './api'

export const SHARED_SITE = 'Shared / multi-site'
export const UNASSIGNED_SITE = 'Unassigned'

// Display mapping only. No location is inferred from a host/IP/network prefix.
export function observedServiceSite(service: Pick<Service, 'site'>, sites: Site[] = []): string {
  const value = typeof service.site === 'string' ? service.site.trim() : ''
  if (!value) return UNASSIGNED_SITE
  if (value.toLowerCase() === 'both sites') return SHARED_SITE
  const declared = sites.find(item => item.id === value || item.name === value)
  return declared?.name || value
}

export function observedIncidentSite(
  incident: Pick<FridayIncident, 'serviceId'>,
  services: Service[], sites: Site[] = [],
): string {
  if (!incident.serviceId) return UNASSIGNED_SITE
  const match = services.find(service => service.id === incident.serviceId)
  return match ? observedServiceSite(match, sites) : UNASSIGNED_SITE
}
