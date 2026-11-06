import type { FormEventHandler, ReactNode } from 'react'
import { Activity, AlertTriangle, ChevronRight, Globe, Layers, Server, ShieldCheck } from 'lucide-react'
import type { FridayIncident, FridayOverview } from '../lib/api'
import type { FridaySessionMessage } from '../hooks/useFridaySession'
import FridayComposer from './FridayComposer'
import FridayConversation from './FridayConversation'
import { summarizeHealth } from '../lib/status'

const severityRank = { high: 0, warning: 1, info: 2 } as const
const statusRank = { offline: 0, degraded: 1, maintenance: 2, online: 3 } as const

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function greeting(now = new Date()) {
  const hour = now.getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted'

function Tag({ tone, children }: { tone: Tone, children: ReactNode }) {
  return <span className={`fx-m-tag ${tone}`}><i aria-hidden="true"/>{children}</span>
}

type MobileHomeProps = {
  overview: FridayOverview
  connected: boolean
  query: string
  messages: FridaySessionMessage[]
  loading: boolean
  onQueryChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onNavigate: (destination: string) => void
  activity?: ReactNode
  onSelectIncident: (incident: FridayIncident) => void
}

export default function MobileHome({
  overview,
  connected,
  query,
  messages,
  loading,
  onQueryChange,
  onSubmit,
  onNavigate,
  activity,
  onSelectIncident,
}: MobileHomeProps) {
  const active = (overview.incidents ?? [])
    .filter((incident) => incident.status === 'open')
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.openedAt.localeCompare(a.openedAt))
  const primaryIncident = active[0]
  const health = summarizeHealth(overview.services, active.length)
  const serviceAttention = health.attention
  const prioritizedServices = overview.services
    .slice()
    .sort((a, b) => statusRank[a.status] - statusRank[b.status])
    .slice(0, 5)

  const preferredInfrastructure = overview.services
    .slice()
    .sort((a, b) => {
      const preferred = (value: typeof a) => /proxmox|vm\s?100|vm\s?102/i.test(`${value.name} ${value.host}`) ? 0 : 1
      return preferred(a) - preferred(b)
    })
  const infrastructure = preferredInfrastructure.filter((service, index, items) => {
    const key = `${service.host}:${service.name}`
    return items.findIndex((item) => `${item.host}:${item.name}` === key) === index
  }).slice(0, 3)

  const sitesOnline = overview.sites.filter((site) => site.status === 'online').length
  const statusLine = !health.total
    ? 'No services observed yet.'
    : active.length
      ? `${active.length} open incident${active.length === 1 ? '' : 's'}. ${health.online} of ${health.total} services online.`
      : serviceAttention.length
        ? `Core ops running. ${serviceAttention.length} service${serviceAttention.length === 1 ? '' : 's'} ${serviceAttention.length === 1 ? 'needs' : 'need'} attention.`
        : 'Core ops normal. All services online.'
  const statusTone: Tone = active.length || serviceAttention.some((s) => s.status === 'offline') ? 'bad' : serviceAttention.length ? 'warn' : health.total ? 'ok' : 'muted'

  return <div className="v3-mobile-home fx-m-home" data-testid="mobile-home">
    <section className="v3-mobile-friday fx-m-hero" data-mobile-section="friday">
      <h1>{greeting()}</h1>
      <p className={`fx-m-status ${statusTone}`}><i aria-hidden="true"/>{statusLine}</p>
      <h2 className="v3-visually-hidden">Ask FRIDAY</h2>
      <FridayComposer
        value={query}
        loading={loading}
        placeholder="Ask about infrastructure…"
        onChange={onQueryChange}
        onSubmit={onSubmit}
      />
      <FridayConversation messages={messages} compact/>
      <small className="fx-m-mode">{connected ? `API connected · ${overview.mode} mode` : 'Local preview data · safe read-only interface'}</small>
    </section>

    <section className="v3-mobile-health fx-m-stats" data-mobile-section="health" aria-label="System health summary">
      <article><header><Layers size={16} aria-hidden="true"/><Tag tone={serviceAttention.length ? (serviceAttention.some((s) => s.status === 'offline') ? 'bad' : 'warn') : 'ok'}>{serviceAttention.length ? 'Degraded' : 'Online'}</Tag></header><strong>{health.online}/{health.total}</strong><span>Services online</span></article>
      <article><header><AlertTriangle size={16} aria-hidden="true"/><Tag tone={active.length ? 'bad' : 'ok'}>{active.length ? 'Open' : 'Clear'}</Tag></header><strong>{active.length}</strong><span>Incidents</span></article>
      <article><header><Globe size={16} aria-hidden="true"/><Tag tone={sitesOnline === overview.sites.length ? 'ok' : 'warn'}>{sitesOnline === overview.sites.length ? 'Online' : 'Check'}</Tag></header><strong>{overview.sites.length} {overview.sites.length === 1 ? 'site' : 'sites'}</strong><span>Active sites</span></article>
      <article><header><Activity size={16} aria-hidden="true"/><Tag tone={health.level === 'nominal' ? 'ok' : health.level === 'critical' ? 'bad' : health.level === 'unknown' ? 'muted' : 'warn'}>{health.label}</Tag></header><strong>{health.percent === null ? '—' : `${health.percent}%`}</strong><span>Health</span></article>
    </section>

    <section className={`v3-mobile-attention fx-m-attention ${primaryIncident ? primaryIncident.severity : serviceAttention.length ? health.level : 'nominal'}`} data-mobile-section="attention">
      {primaryIncident ? <>
        <div className="fx-m-section-head"><div><h2>Needs attention</h2><span className="fx-m-kicker">{active.length} {primaryIncident.severity.toUpperCase()} INCIDENT{active.length === 1 ? '' : 'S'}</span></div><button type="button" onClick={() => onNavigate('Incidents')}>View all</button></div>
        <article className={`fx-m-alert ${primaryIncident.severity === 'high' ? 'bad' : 'warn'}`}>
          <header><span className="fx-m-alert-icon"><AlertTriangle size={18} aria-hidden="true"/></span><div><h3>{primaryIncident.serviceName || primaryIncident.title}</h3><Tag tone={primaryIncident.severity === 'high' ? 'bad' : 'warn'}>{primaryIncident.severity}</Tag><small>{primaryIncident.host || primaryIncident.source} · {primaryIncident.type.replaceAll('-', ' ')}</small></div></header>
          <pre>{primaryIncident.detail}</pre>
          <footer><span>First seen {displayTime(primaryIncident.firstSeen)}</span><button className="v3-readonly-action" onClick={() => onSelectIncident(primaryIncident)}>View Diagnosis <ChevronRight size={14}/></button></footer>
        </article>
      </> : serviceAttention.length ? <>
        <div className="fx-m-section-head"><div><h2>{serviceAttention.length} {serviceAttention.length === 1 ? 'service needs' : 'services need'} attention</h2><span className="fx-m-kicker">NO OPEN INCIDENT</span></div><button type="button" onClick={() => onNavigate('Infrastructure')}>View services</button></div>
        {serviceAttention.slice(0, 3).map((service) => <article key={service.id} className={`fx-m-alert ${service.status === 'offline' ? 'bad' : 'warn'}`}>
          <header><span className="fx-m-alert-icon"><Server size={18} aria-hidden="true"/></span><div><h3>{service.name}</h3><Tag tone={service.status === 'offline' ? 'bad' : 'warn'}>{service.status}</Tag><small>{service.host} · {service.updated}</small></div></header>
          <pre>{service.detail}</pre>
        </article>)}
      </> : <div className="v3-mobile-nominal fx-m-nominal"><ShieldCheck size={20}/><div><h2>System nominal</h2><p>No open operational incidents require attention.</p></div></div>}
    </section>

    <section className="v3-mobile-infrastructure" data-mobile-section="infrastructure">
      <div className="fx-m-section-head"><h2>Infrastructure</h2><button type="button" onClick={() => onNavigate('Infrastructure')}>View topology</button></div>
      <div className="v3-mobile-infra-list">{infrastructure.map((service) => <article key={service.id}><Server size={16}/><span><b>{service.name}</b><small>{service.host} · {service.detail}</small></span><em className={service.status}>{service.status}</em></article>)}</div>
    </section>

    {activity}

    <section className="v3-mobile-services" data-mobile-section="services" data-testid="mobile-service-preview">
      <div className="fx-m-section-head"><h2>Service health</h2><button type="button" onClick={() => onNavigate('Applications')}>View all services</button></div>
      <div className="v3-mobile-service-list">{prioritizedServices.map((service) => <div className="v3-mobile-service-row" data-testid="mobile-service-row" key={service.id}><i className={service.status}/><span><b>{service.name}</b><small>{service.host}</small></span><em>{service.status}</em></div>)}</div>
    </section>
  </div>
}
