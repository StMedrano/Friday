import NotConnected from './NotConnected'
import { useEffect, useMemo, useState } from 'react'
import { AppWindow, Search, ShieldCheck } from 'lucide-react'
import { fetchFridayUptime, type FridayOverview, type FridayServiceUptime, type FridayUptimeResult } from '../lib/api'
import type { Service } from '../lib/infrastructure'

type Props = { overview: FridayOverview; connected: boolean }
type Filter = 'all' | 'attention' | 'online'

const applicationCategories = new Set<Service['category']>(['app', 'media', 'container'])
const priority: Record<Service['status'], number> = {
  offline: 0, degraded: 1, maintenance: 2, online: 3,
}

const REFRESH_MS = 5 * 60 * 1000

function percent(value: number | null | undefined) {
  return typeof value === 'number' ? `${value.toFixed(value === 100 ? 0 : 2)}%` : '—'
}

/** Last 24 hourly buckets as bars: height is the share of up checks, colour marks any downtime. */
function UptimeBars({ uptime, label }: { uptime?: FridayServiceUptime; label?: string }) {
  if (!uptime || uptime.hourly.length === 0) return <span className="fx-app-spark" aria-hidden="true" title="No uptime samples yet"/>
  return <span className="fx-uptime-bars" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {uptime.hourly.map((hour) => {
      const checks = hour.online + hour.degraded + hour.offline
      const share = checks ? (hour.online + hour.degraded) / checks : 1
      const state = !checks ? 'maintenance' : hour.offline ? 'down' : hour.degraded ? 'degraded' : 'up'
      return <i key={hour.at} className={state} style={{ height: `${Math.max(15, Math.round(share * 100))}%` }}
        title={`${new Date(hour.at).toLocaleString()}: ${hour.online} online, ${hour.degraded} degraded, ${hour.offline} offline, ${hour.maintenance} maintenance`}/>
    })}
  </span>
}

function UptimeDetail({ uptime, name }: { uptime?: FridayServiceUptime; name: string }) {
  if (!uptime || (uptime.last7d.checks === 0 && uptime.hourly.length === 0)) {
    return <section className="fx-uptime-detail" aria-label="Uptime history"><span className="v3-kicker">UPTIME</span><p>No uptime samples have been recorded for {name} yet.</p></section>
  }
  return <section className="fx-uptime-detail" aria-label="Uptime history">
    <span className="v3-kicker">UPTIME · FROM FRIDAY MONITORING</span>
    <dl>
      <div><dt>Last 24 hours</dt><dd>{percent(uptime.last24h.uptime)}</dd></div>
      <div><dt>Last 7 days</dt><dd>{percent(uptime.last7d.uptime)}</dd></div>
      <div><dt>Checks (24h)</dt><dd>{uptime.last24h.checks}</dd></div>
      <div><dt>Offline checks (24h)</dt><dd>{uptime.last24h.offline}</dd></div>
    </dl>
    <UptimeBars uptime={uptime} label={`Hourly uptime for ${name}, last 24 hours`}/>
    <p>Degraded checks count as up. Maintenance is not counted.</p>
  </section>
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
  const [uptime, setUptime] = useState<FridayUptimeResult | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const load = () => fetchFridayUptime(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setUptime(result) })
      .catch(() => { if (!controller.signal.aborted) setUptime({ state: 'unavailable' }) })
    void load()
    const timer = setInterval(() => { void load() }, REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [])
  const uptimeById = useMemo(() => new Map((uptime?.state === 'ok' ? uptime.services : []).map((item) => [item.serviceId, item])), [uptime])
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
              <span className="fx-app-meta" aria-hidden="true">
                <span><small>Uptime 24h</small>{uptimeById.get(service.id)?.last24h.uptime != null
                  ? <b>{percent(uptimeById.get(service.id)?.last24h.uptime)}</b> : <b className="fx-na">—</b>}</span>
                <span><small>Last check</small><b>{service.updated || '—'}</b></span>
              </span>
              {uptime?.state === 'ok' ? <UptimeBars uptime={uptimeById.get(service.id)}/>
                : <span className="fx-app-spark" aria-hidden="true" title="Uptime history is not connected"/>}
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
        {uptime?.state === 'ok' ? (selected ? <UptimeDetail uptime={uptimeById.get(selected.id)} name={selected.name}/> : null)
          : uptime?.state === 'unavailable' ? <p className="v3-applications-empty" role="status">Uptime history could not be loaded.</p>
            : <NotConnected title="Uptime history" detail="Uptime percentages and trend lines need the monitoring uptime record (FRIDAY_MONITORING_UPTIME_ENABLED) on the server." />}
        <NotConnected title="Open app" detail="Launching apps from Friday is not enabled." action="Open" />
      </aside>
    </div>
  </section>
}
