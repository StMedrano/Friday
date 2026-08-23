import type { FormEventHandler } from 'react'
import { AlertTriangle, ChevronRight, Command, Server, ShieldCheck } from 'lucide-react'
import type { FridayIncident, FridayOverview } from '../lib/api'
import AssistantReply, { type AssistantReplyState } from './AssistantReply'

const severityRank = { high: 0, warning: 1, info: 2 } as const
const statusRank = { offline: 0, degraded: 1, maintenance: 2, online: 3 } as const

function displayTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

type MobileHomeProps = {
  overview: FridayOverview
  connected: boolean
  query: string
  assistant: AssistantReplyState
  onQueryChange: (value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onNavigate: (destination: string) => void
  onSelectIncident: (incident: FridayIncident) => void
}

export default function MobileHome({
  overview,
  connected,
  query,
  assistant,
  onQueryChange,
  onSubmit,
  onNavigate,
  onSelectIncident,
}: MobileHomeProps) {
  const active = (overview.incidents ?? [])
    .filter((incident) => incident.status === 'open')
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.openedAt.localeCompare(a.openedAt))
  const primaryIncident = active[0]
  const online = overview.services.filter((service) => service.status === 'online').length
  const health = Math.round((online / Math.max(overview.services.length, 1)) * 100)
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

  return <div className="v3-mobile-home" data-testid="mobile-home">
    <section className={`v3-mobile-attention ${primaryIncident ? primaryIncident.severity : 'nominal'}`} data-mobile-section="attention">
      {primaryIncident ? <>
        <div className="v3-mobile-attention-head"><AlertTriangle size={18}/><span>{active.length} {primaryIncident.severity.toUpperCase()} INCIDENT{active.length === 1 ? '' : 'S'}</span></div>
        <div className="v3-mobile-attention-main"><div><span className="v3-kicker">REQUIRES ATTENTION / READ ONLY</span><h1>{primaryIncident.serviceName || primaryIncident.title}</h1><p>{primaryIncident.host || primaryIncident.source} · {primaryIncident.type.replaceAll('-', ' ')}</p></div><span className={`v3-severity ${primaryIncident.severity}`}>{primaryIncident.severity.toUpperCase()}</span></div>
        <div className="v3-mobile-attention-foot"><span>First seen {displayTime(primaryIncident.firstSeen)}</span><button className="v3-readonly-action" onClick={() => onSelectIncident(primaryIncident)}>View Diagnosis <ChevronRight size={14}/></button></div>
      </> : <div className="v3-mobile-nominal"><ShieldCheck size={20}/><div><span className="v3-kicker">CURRENT ATTENTION</span><h1>System nominal</h1><p>No open operational incidents require attention.</p></div></div>}
    </section>

    <section className="v3-mobile-health" data-mobile-section="health" aria-label="System health summary">
      <article><span>Health</span><strong>{health}%</strong></article>
      <article><span>Services</span><strong>{online}/{overview.services.length}</strong></article>
      <article><span>Incidents</span><strong>{active.length}</strong></article>
      <article><span>Sites</span><strong>{overview.sites.length} {overview.sites.length === 1 ? 'site' : 'sites'}</strong></article>
    </section>

    <section className="v3-mobile-friday" data-mobile-section="friday">
      <div className="v3-mobile-core" aria-hidden="true"><span/></div>
      <div className="v3-mobile-command-copy"><span className="v3-kicker">FRIDAY / {overview.mode.toUpperCase()}</span><h2>Ask FRIDAY</h2><p>{connected ? `API connected · ${overview.mode} mode` : 'Local preview data · safe read-only interface'}</p></div>
      <form className="v3-mobile-command-form" onSubmit={onSubmit}><Command size={17}/><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Ask about infrastructure…" disabled={assistant.loading}/><button aria-label="Send command" disabled={assistant.loading}><ChevronRight size={17}/></button></form>
      <AssistantReply state={assistant} compact />
    </section>

    <section className="v3-mobile-infrastructure" data-mobile-section="infrastructure">
      <div className="v3-mobile-section-head"><div><span className="v3-kicker">SYSTEM</span><h2>Infrastructure</h2></div><button onClick={() => onNavigate('Infrastructure')}>View topology</button></div>
      <div className="v3-mobile-infra-list">{infrastructure.map((service) => <article key={service.id}><Server size={16}/><span><b>{service.name}</b><small>{service.host} · {service.detail}</small></span><em className={service.status}>{service.status}</em></article>)}</div>
    </section>

    <section className="v3-mobile-services" data-mobile-section="services" data-testid="mobile-service-preview">
      <div className="v3-mobile-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2>Service health</h2></div><button onClick={() => onNavigate('Applications')}>View all services</button></div>
      <div className="v3-mobile-service-list">{prioritizedServices.map((service) => <div className="v3-mobile-service-row" data-testid="mobile-service-row" key={service.id}><i className={service.status}/><span><b>{service.name}</b><small>{service.host}</small></span><em>{service.status}</em></div>)}</div>
    </section>
  </div>
}
