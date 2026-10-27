import { useMemo, useState } from 'react'
import { AppWindow, Search, ShieldCheck } from 'lucide-react'
import type { FridayOverview } from '../lib/api'
import type { Service } from '../lib/infrastructure'

type Props = { overview: FridayOverview; connected: boolean }
type Filter = 'all' | 'attention' | 'online'

const applicationCategories = new Set<Service['category']>(['app', 'media', 'container'])
const priority: Record<Service['status'], number> = {
  offline: 0, degraded: 1, maintenance: 2, online: 3,
}

function observation(value: string) {
  if (!value) return 'Not reported'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : 'Not reported'
}

/**
 * An inventory of observed application-related *services* (not a discovery
 * system or trusted application launcher). No user-entered URL is rendered,
 * and this component has no management or mutation methods.
 */
export default function ApplicationsWorkspace({ overview, connected }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const observed = useMemo(() => overview.services
    .filter(service => applicationCategories.has(service.category))
    .slice()
    .sort((a, b) => priority[a.status] - priority[b.status] || a.name.localeCompare(b.name)), [overview.services])
  const visible = useMemo(() => observed.filter(service => {
    if (filter === 'online' && service.status !== 'online') return false
    if (filter === 'attention' && service.status === 'online') return false
    const terms = [service.id, service.name, service.host, service.site, service.category].join(' ').toLocaleLowerCase()
    return terms.includes(search.trim().toLocaleLowerCase())
  }), [observed, filter, search])
  const selected = observed.find(service => service.id === selectedId)
  const live = connected && overview.mode === 'live'

  return <section className="v3-applications-workspace" aria-label="Applications workspace">
    <header className="v3-applications-hero">
      <div><span className="v3-kicker">FRIDAY / OBSERVABILITY</span><h2>Applications</h2>
        <p>Observed application-related services from Friday's normalized inventory, not an installed-app catalog or verified launcher.</p>
      </div>
      <span className="v3-applications-mode"><ShieldCheck size={14}/>{live ? 'Live inventory · read only' : 'Preview only · not verified live'}</span>
    </header>
    <div className="v3-applications-counts" aria-label="Application inventory summary">
      <article><span>Observed</span><strong>{observed.length}</strong></article>
      <article><span>Online</span><strong>{observed.filter(item => item.status === 'online').length}</strong></article>
      <article><span>Needs attention</span><strong>{observed.filter(item => item.status !== 'online').length}</strong></article>
    </div>
    <div className="v3-applications-controls">
      <label className="v3-applications-search"><Search size={15}/>
        <span className="sr-only">Search observed applications</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          aria-label="Search observed applications" placeholder="Search name, site or host"/>
      </label>
      <div className="v3-applications-filters" role="group" aria-label="Filter application health">
        {([['all', 'All health'], ['attention', 'Attention'], ['online', 'Online']] as const).map(([value, label]) =>
          <button type="button" key={value} aria-pressed={filter === value}
            onClick={() => setFilter(value)}>{label}</button>)}
      </div>
    </div>
    <div className="v3-applications-layout">
      <section className="v3-applications-list" aria-label="Observed application services">
        {!observed.length ? <p className="v3-applications-empty">No application-related services are present in the current inventory. Configure approved read-only integrations before treating this as a complete catalog.</p>
          : !visible.length ? <p className="v3-applications-empty">No observed services match the selected search and health filter.</p>
          : visible.map(service => <button type="button" key={service.id}
              className={selectedId === service.id ? 'v3-applications-row selected' : 'v3-applications-row'}
              aria-pressed={selectedId === service.id} onClick={() => setSelectedId(service.id)}>
              <AppWindow size={17} aria-hidden="true"/>
              <span className="v3-applications-name"><strong>{service.name}</strong>
                <small>{service.site || 'Unassigned'} · {service.host || 'Unknown host'} · {service.category}</small>
              </span>
              <span className={'v3-applications-health '+service.status}>{service.status}</span>
            </button>)}
      </section>
      <aside className="v3-applications-detail" aria-label="Selected service evidence">
        {selected ? <>
          <span className="v3-kicker">OBSERVED SERVICE · READ ONLY</span><h3>{selected.name}</h3>
          <dl>
            <div><dt>Service ID</dt><dd>{selected.id}</dd></div>
            <div><dt>Category</dt><dd>{selected.category}</dd></div>
            <div><dt>Site</dt><dd>{selected.site || 'Unassigned'}</dd></div>
            <div><dt>Host</dt><dd>{selected.host || 'Unknown'}</dd></div>
            <div><dt>Status</dt><dd>{selected.status}</dd></div>
            <div><dt>Last observed</dt><dd>{observation(selected.updated)}</dd></div>
          </dl>
          <p>{selected.detail || 'No service detail provided.'}</p>
        </> : <p>Select an observed service to inspect its status and evidence. App launching and management are not enabled.</p>}
      </aside>
    </div>
  </section>
}
