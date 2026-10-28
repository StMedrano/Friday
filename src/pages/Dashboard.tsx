import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AppWindow, Bot, Boxes, CheckCircle2, ChevronRight, Cpu, Database, FolderGit2, HardDrive, Home, MemoryStick, Network, Server, Settings, ShieldCheck, Sparkles } from 'lucide-react'
import { fetchMonitoringHistory, useFridayOverview, type FridayIncident, type MonitoringEvent } from '../lib/api'
import { useFridaySession } from '../hooks/useFridaySession'
import { statusLabel, summarizeHealth } from '../lib/status'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import ActiveIncidents from '../components/ActiveIncidents'
import AgentsWorkspace from '../components/AgentsWorkspace'
import ApplicationsWorkspace from '../components/ApplicationsWorkspace'
import FridayComposer from '../components/FridayComposer'
import FridayConversation from '../components/FridayConversation'
import FridayWorkspace from '../components/FridayWorkspace'
import IncidentsWorkspace from '../components/IncidentsWorkspace'
import InfrastructureWorkspace from '../components/InfrastructureWorkspace'
import MobileHome from '../components/MobileHome'
import MobileNavigation from '../components/MobileNavigation'
import RepositoriesWorkspace from '../components/RepositoriesWorkspace'
import '../monitoring.css'
import '../mobile.css'
import '../assistant.css'
import '../agents.css'
import '../repositories.css'
import '../applications.css'

const nav = [
  ['Overview', Home], ['FRIDAY', Sparkles], ['Infrastructure', Server], ['Applications', AppWindow],
  ['Agents', Bot], ['Repositories', FolderGit2], ['Tasks', CheckCircle2], ['Approvals', ShieldCheck], ['Incidents', AlertTriangle],
  ['Memory', Database], ['Audit', Activity], ['Settings', Settings],
] as const

export default function Dashboard() {
  const { overview, connected } = useFridayOverview()
  const friday = useFridaySession()
  const isPhone = usePhoneLayout()
  const [active, setActive] = useState('Overview')
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<MonitoringEvent[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const incidents = overview.incidents ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null
  const activeIncidents = overview.monitoring?.activeIncidents ?? incidents.filter((incident) => incident.status === 'open').length
  const health = summarizeHealth(overview.services, activeIncidents)
  const live = connected && overview.mode === 'live'
  const metrics = useMemo(() => overview.resources.slice(0, 3), [overview.resources])

  useEffect(() => {
    if (active !== 'Incidents') return
    const controller = new AbortController()
    setHistoryError(null)
    fetchMonitoringHistory(controller.signal)
      .then(setHistory)
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setHistory([])
          setHistoryError('History unavailable')
        }
      })
    return () => controller.abort()
  }, [active])

  async function submitFriday(event: React.FormEvent) {
    event.preventDefault()
    const text = query.trim()
    if (!text || friday.loading) return
    setQuery('')
    await friday.sendMessage(text)
  }

  function navigate(destination: string) {
    setActive(destination)
    if (destination !== 'Incidents') setSelectedIncidentId(null)
  }

  function viewDiagnosis(incident: FridayIncident) {
    setSelectedIncidentId(incident.id)
    setActive('Incidents')
  }

  if (isPhone) {
    return <div className="v3-shell v3-phone-shell">
      <div className="v3-workspace">
        <header className="v3-mobile-header">
          <div className="v3-mobile-brand"><span className="v3-live-dot"/><strong>FRIDAY</strong><small>AI OPERATIONS</small></div>
          <div className={`v3-mobile-status ${connected ? 'online' : 'warning'}`}><i/>{connected ? 'LIVE' : 'SAFE'}</div>
        </header>
        <main className="v3-main">
          {active === 'Overview' ? <MobileHome
            overview={overview}
            connected={connected}
            query={query}
            messages={friday.messages}
            loading={friday.loading}
            onQueryChange={setQuery}
            onSubmit={submitFriday}
            onNavigate={navigate}
            onSelectIncident={viewDiagnosis}
          /> : active === 'FRIDAY' ? <FridayWorkspace
            session={friday}
            query={query}
            onQueryChange={setQuery}
            onSubmit={submitFriday}
          /> : active === 'Agents' ? <AgentsWorkspace/> : active === 'Repositories' ? <RepositoriesWorkspace/> : active === 'Applications' ? <ApplicationsWorkspace overview={overview} connected={connected}/> : active === 'Infrastructure' ? <InfrastructureWorkspace overview={overview} connected={connected}/> : active === 'Incidents' ? <IncidentsWorkspace
            incidents={incidents}
            services={overview.services}
            sites={overview.sites}
            monitoring={overview.monitoring}
            history={history}
            historyError={historyError}
            selectedIncident={selectedIncident}
            onSelectIncident={viewDiagnosis}
            onClearSelection={() => setSelectedIncidentId(null)}
          /> : <PendingCapabilityView name={active}/>} 
        </main>
      </div>
      <MobileNavigation active={active} activeIncidents={activeIncidents} onNavigate={navigate}/>
    </div>
  }

  return (
    <div className="v3-shell">
      <aside className="v3-rail">
        <button className="v3-logo" onClick={() => navigate('Overview')} aria-label="FRIDAY home"><span /></button>
        <nav>{nav.map(([label, Icon]) => <button key={label} aria-label={label} className={active === label ? 'active' : ''} onClick={() => navigate(label)} title={label}><Icon size={19}/>{label === 'Incidents' && activeIncidents > 0 && <i>{activeIncidents}</i>}</button>)}</nav>
        <div className="v3-avatar">SM</div>
      </aside>

      <div className="v3-workspace">
        <header className="v3-topbar">
          <div><strong>FRIDAY</strong><span>AI OPERATIONS CONTROL</span></div>
          <div className={`v3-system ${live ? 'live' : 'unavailable'}`} role="status" aria-label="Live data status"><i /> {live ? 'READ-ONLY MONITORING' : 'LIVE STATUS UNAVAILABLE'}</div>
        </header>

        <main className="v3-main">
          <section className="v3-intro">
            <div><span className="v3-kicker">COMMAND CENTER / {active.toUpperCase()}</span><h1>{active === 'Overview' ? 'Good afternoon.' : active}</h1><p>{connected ? `API connected · ${overview.mode} mode` : 'Local preview data · safe read-only interface'}</p></div>
            <div className="v3-automation" role="status" aria-label="Automation execution status"><span><b>Automation</b><small>Automation is unavailable for execution · read only</small></span><em aria-hidden="true" /></div>
          </section>

          {active === 'Overview' ? <>
            <section className="v3-friday">
              <div className="v3-core-wrap"><div className="v3-ring r1"/><div className="v3-ring r2"/><div className="v3-core"><span/></div></div>
              <div className="v3-command">
                <span className="v3-kicker">FRIDAY / ONLINE</span>
                <h2>What would you like me to handle?</h2>
                <p>Ask about servers, applications, incidents, deployments, networking, logs, or system health.</p>
                <FridayConversation messages={friday.messages} compact/>
                <FridayComposer value={query} loading={friday.loading} placeholder="Ask FRIDAY anything…" onChange={setQuery} onSubmit={submitFriday}/>
                {friday.messages.length > 0 && <button type="button" className="v3-friday-continue" onClick={() => navigate('FRIDAY')}>Continue conversation <ChevronRight size={14}/></button>}
              </div>
              <section className={`v3-health ${health.level}`} aria-label="System health">
                <span className="v3-kicker">SYSTEM HEALTH</span>
                <div className="v3-health-score"><strong>{health.percent === null ? '—' : `${health.percent}%`}</strong><span>{health.label}</span></div>
                {health.attention.length > 0 && <ul className="v3-health-attention">{health.attention.slice(0, 2).map((service) => <li key={service.id} className={service.status}><b>{service.name}</b> <span>{statusLabel(service.status)}</span></li>)}</ul>}
                <div className="v3-health-row"><span>Services online</span><b>{health.online}/{health.total}</b></div>
                <div className="v3-health-row"><span>Active incidents</span><b>{activeIncidents}</b></div>
                <div className="v3-health-row"><span>Sites</span><b>{overview.sites.length}</b></div>
              </section>
            </section>

            <ActiveIncidents incidents={incidents} onSelectIncident={viewDiagnosis}/>

            <section className="v3-section">
              <div className="v3-section-head"><div><span className="v3-kicker">SYSTEM</span><h2>Infrastructure</h2></div><button onClick={() => navigate('Infrastructure')}>View topology <ChevronRight size={15}/></button></div>
              <div className="v3-infra">{overview.services.slice(0, 3).map((service, idx) => <article key={service.id}><div className="v3-node-icon">{idx === 0 ? <Server/> : idx === 1 ? <Boxes/> : <Network/>}</div><div><span>{service.category.toUpperCase()}</span><h3>{service.name}</h3><p>{service.host} · {service.detail}</p></div><div className={`v3-status ${service.status}`}><i/>{service.status}</div></article>)}</div>
            </section>

            <section className="v3-grid">
              <div className="v3-panel"><div className="v3-section-head"><div><span className="v3-kicker">TELEMETRY</span><h2>VM 100 · Infrastructure</h2></div><span className="v3-live"><i/> LIVE</span></div><div className="v3-metrics">{metrics.map((m, i) => <div key={m.label}><span>{i === 0 ? <Cpu/> : i === 1 ? <MemoryStick/> : <HardDrive/>}{m.label}</span><strong>{m.value}%</strong><div><i style={{width:`${m.value}%`}}/></div><small>{m.helper}</small></div>)}</div></div>
              <section className="v3-panel" aria-labelledby="v3-needs-attention"><div className="v3-section-head"><div><span className="v3-kicker">SERVICES</span><h2 id="v3-needs-attention">Needs attention</h2></div><button onClick={() => navigate('Infrastructure')}>View all services <ChevronRight size={15}/></button></div><div className="v3-agents">{health.attention.length ? health.attention.slice(0, 4).map((service) => <div key={service.id}><i className={service.status}/><span><b>{service.name}</b><small>{service.host} · {service.detail}</small></span><em className={service.status}>{statusLabel(service.status)}</em></div>) : <div><i className="on"/><span><b>No service issues</b><small>{!health.total ? 'No services observed yet.' : health.online === health.total ? 'Every observed service reports online.' : `${health.total - health.online} in maintenance · the rest report online.`}</small></span></div>}</div></section>
            </section>

            <section className="v3-section"><div className="v3-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2>Service health</h2></div><span>{health.online} online</span></div><div className="v3-services">{overview.services.map(s => <button key={s.id} onClick={() => navigate('Applications')}><i className={s.status}/><span><b>{s.name}</b><small>{s.host}</small></span><em>{s.updated}</em></button>)}</div></section>
          </> : active === 'FRIDAY' ? <FridayWorkspace session={friday} query={query} onQueryChange={setQuery} onSubmit={submitFriday}/>
            : active === 'Agents' ? <AgentsWorkspace/>
            : active === 'Applications' ? <ApplicationsWorkspace overview={overview} connected={connected}/>
            : active === 'Repositories' ? <RepositoriesWorkspace/>
            : active === 'Infrastructure' ? <InfrastructureWorkspace overview={overview} connected={connected}/>
            : active === 'Incidents' ? <IncidentsWorkspace incidents={incidents} services={overview.services} sites={overview.sites} monitoring={overview.monitoring} history={history} historyError={historyError} selectedIncident={selectedIncident} onSelectIncident={viewDiagnosis} onClearSelection={() => setSelectedIncidentId(null)}/>
                        : <PendingCapabilityView name={active} />}
        </main>
      </div>
    </div>
  )
}

function PendingCapabilityView({ name }: { name: string }) {
  const details: Record<string, string> = {
    Tasks: 'The Phase 2B task and handoff services exist internally, but are not yet exposed through an authenticated, project-scoped production API.',
    Memory: 'Scoped persistent and short-lived memory services exist internally, but the production UI has no approved identity-bound memory API.',
    Approvals: 'The durable internal approval foundations are not a public approval queue. Signed identity, operator policy and audit must be connected first.',
    Audit: 'Monitoring events are not a substitute for the durable action audit. An identity-scoped operator audit API has not been activated.',
    Settings: 'Server-side integration, authorization and automation settings must be inspected through a reviewed administrative interface before controls become available.',
  }
  return <section className="v3-pending-capability" aria-label={name + ' availability'}>
    <span className="v3-kicker">FRIDAY / RELEASE STATUS</span>
    <h2>{name} is not connected</h2>
    <p>{details[name] || 'This workspace has no production-backed service yet.'}</p>
    <p>No production task, memory or approval operation is available on this screen.</p>
    <div role="status">Not activated · read only · no action controls</div>
  </section>
}
