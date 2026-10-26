import { useMemo, useState } from 'react'
import { Network, Server, ShieldCheck } from 'lucide-react'
import type { FridayOverview } from '../lib/api'
import type { Service } from '../lib/infrastructure'

const SHARED = 'Shared / multi-site'
const UNASSIGNED = 'Unassigned'
const statusPriority = { offline: 0, degraded: 1, maintenance: 2, online: 3 } as const

// Site labels are evidence from normalized state, not inferred host/IP topology.
// A "Both Sites" label is not proof of a particular service-to-site link.
function serviceSite(service: Service, overview: FridayOverview) {
  const value = typeof service.site === 'string' ? service.site.trim() : ''
  if (!value) return UNASSIGNED
  if (value.toLowerCase() === 'both sites') return SHARED
  const explicit = overview.sites.find(site => site.id === value || site.name === value)
  return explicit?.name || value
}

function hostLabel(host: string) {
  return typeof host === 'string' && host.trim() ? host.trim() : 'Unknown host'
}

export default function InfrastructureWorkspace({ overview, connected }: {
  overview: FridayOverview
  connected: boolean
}) {
  const [requestedSite, setRequestedSite] = useState<string>('all')
  const { names, counts, buckets } = useMemo(() => {
    const names = new Set<string>()
    const buckets = new Map<string, Service[]>()
    for (const site of overview.sites) {
      if (typeof site.name === 'string' && site.name.trim()) names.add(site.name.trim())
    }
    for (const service of overview.services) {
      const name = serviceSite(service, overview)
      names.add(name)
      buckets.set(name, [...(buckets.get(name) ?? []), service])
    }
    const ordered = [...names].sort((a, b) => {
      const last = (value: string) => value === SHARED ? 1 : value === UNASSIGNED ? 2 : 0
      return last(a) - last(b) || a.localeCompare(b)
    })
    return { names: ordered, buckets, counts: new Map(ordered.map(name => [name, buckets.get(name)?.length ?? 0])) }
  }, [overview])

  const selectedSite = requestedSite === 'all' || names.includes(requestedSite) ? requestedSite : 'all'
  const visible = selectedSite === 'all' ? overview.services : buckets.get(selectedSite) ?? []
  const attention = visible.filter(service => service.status !== 'online').length

  const hosts = new Map<string, Service[]>()
  for (const service of visible) {
    const host = hostLabel(service.host)
    hosts.set(host, [...(hosts.get(host) ?? []), service])
  }
  const hostGroups = [...hosts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const source = connected && overview.mode === 'live' ? 'Live API inventory' : 'Preview data · not live'

  return <section className="v3-detail v3-topology-workspace" aria-label="Infrastructure workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><Network aria-hidden="true"/></div>
      <div>
        <span className="v3-kicker">FRIDAY / READ-ONLY TOPOLOGY</span>
        <h2>Infrastructure</h2>
        <p>Explore reported sites, hosts, and services. This is an inventory grouping, not a verified network path.</p>
      </div>
    </div>

    <section className="v3-panel v3-topology-panel" aria-label="Site topology">
      <div className="v3-section-head">
        <div><span className="v3-kicker">SITE INVENTORY</span><h2>Observed locations</h2></div>
        <span className="v3-topology-source"><ShieldCheck size={14} aria-hidden="true"/>{source}</span>
      </div>
      {names.length === 0
        ? <p className="v3-topology-empty">No site or service inventory available. Connection or site configuration may be incomplete.</p>
        : <>
          <div className="v3-topology-sites" role="group" aria-label="Filter by site">
            <button type="button" aria-pressed={selectedSite === 'all'} onClick={() => setRequestedSite('all')}>
              <b>All sites</b><small>{overview.services.length} services</small>
            </button>
            {names.map(name => <button key={name} type="button"
              aria-pressed={selectedSite === name}
              onClick={() => setRequestedSite(name)}>
              <b>{name}</b><small>{counts.get(name)} {counts.get(name) === 1 ? 'service' : 'services'}</small>
            </button>)}
          </div>
          <p className="v3-topology-note">Shared / multi-site and Unassigned are separate evidence buckets. Service membership is never guessed from host names.</p>
        </>}
    </section>

    <section className="v3-section v3-topology-results" aria-label="Observed services" aria-live="polite">
      <div className="v3-section-head">
        <div><span className="v3-kicker">HOSTS AND SERVICES</span><h2>{selectedSite === 'all' ? 'All observed services' : selectedSite}</h2></div>
        <span className="v3-topology-count">{visible.length} observed · {attention} require review</span>
      </div>
      {visible.length === 0 ? <div className="v3-incident-empty">
        <Server size={18} aria-hidden="true"/>
        <span>{names.length ? 'No services were observed for this site.' : 'No services are available in the current inventory.'}</span>
      </div> : <div className="v3-topology-hosts">
        {hostGroups.map(([host, services]) => <article className="v3-panel v3-topology-host" key={host}>
          <div className="v3-topology-host-heading">
            <Server size={17} aria-hidden="true"/><h3>{host}</h3>
            <span>{services.length} {services.length === 1 ? 'service' : 'services'}</span>
          </div>
          <div className="v3-topology-service-list">
            {[...services].sort((a, b) => statusPriority[a.status] - statusPriority[b.status] || a.name.localeCompare(b.name))
              .map(service => <div key={service.id} className="v3-topology-service">
                <i className={service.status} aria-hidden="true"/>
                <div><b>{service.name}</b><small>{service.category} · {serviceSite(service, overview)} · {service.detail}</small></div>
                <strong className={service.status}>{service.status}</strong>
              </div>)}
          </div>
        </article>)}
      </div>}
    </section>
  </section>
}
