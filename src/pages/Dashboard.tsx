import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AppWindow, Bot, Boxes, CheckCircle2, ChevronRight, Cpu, Database, FolderGit2, HardDrive, Home, MemoryStick, Network, Search, Server, Settings, ShieldCheck, Sparkles } from 'lucide-react'
import { fetchMonitoringHistory, useFridayOverview, type FridayIncident, type MonitoringEvent } from '../lib/api'
import { useFridaySession } from '../hooks/useFridaySession'
import { statusLabel, statusPriority, summarizeHealth } from '../lib/status'
import { greeting } from '../lib/greeting'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import ActiveIncidents from '../components/ActiveIncidents'
import AgentsWorkspace from '../components/AgentsWorkspace'
import ApplicationsWorkspace from '../components/ApplicationsWorkspace'
import CommandPalette, { type PaletteItem } from '../components/CommandPalette'
import FridayComposer from '../components/FridayComposer'
import FridayConversation from '../components/FridayConversation'
import FridayWorkspace from '../components/FridayWorkspace'
import IncidentsWorkspace from '../components/IncidentsWorkspace'
import InfrastructureWorkspace from '../components/InfrastructureWorkspace'
import ActivityTimeline from '../components/ActivityTimeline'
import TasksWorkspace from '../components/TasksWorkspace'
import MobileHome from '../components/MobileHome'
import MobileNavigation from '../components/MobileNavigation'
import PwaControls from '../components/PwaControls'
import RepositoriesWorkspace from '../components/RepositoriesWorkspace'
import AuditWorkspace from '../components/AuditWorkspace'
import SettingsWorkspace from '../components/SettingsWorkspace'
import '../monitoring.css'
import '../mobile.css'
import '../assistant.css'
import '../agents.css'
import '../repositories.css'
import '../applications.css'
import '../audit.css'
import '../settings.css'

const nav = [
  ['Overview', Home], ['FRIDAY', Sparkles], ['Infrastructure', Server], ['Applications', AppWindow],
  ['Incidents', AlertTriangle], ['Agents', Bot], ['Repositories', FolderGit2],
] as const

const pendingNav = [
  ['Tasks', CheckCircle2], ['Approvals', ShieldCheck], ['Memory', Database], ['Audit', Activity], ['Settings', Settings],
] as const

// Workspaces that render their own titled hero; the page h1 stays for assistive tech only.
const baseTitle = typeof document === 'undefined' ? 'Friday · Control Plane' : document.title || 'Friday · Control Plane'

function PreviewBanner() {
  return <div className="v3-preview-banner" role="note" aria-label="Preview data"><b>Preview data</b><span>The Friday API isn't connected, so the numbers on this screen are sample data.</span></div>
}

const selfTitled = new Set(['Infrastructure', 'Applications', 'Incidents', 'Repositories', 'Agents'])

export default function Dashboard() {
  const { overview, connected } = useFridayOverview()
  const friday = useFridaySession()
  const isPhone = usePhoneLayout()
  const [active, setActive] = useState('Overview')
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<MonitoringEvent[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const incidents = overview.incidents ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null
  const activeIncidents = overview.monitoring?.activeIncidents ?? incidents.filter((incident) => incident.status === 'open').length
  const health = summarizeHealth(overview.services, activeIncidents)
  const live = connected && overview.mode === 'live'
  const metrics = useMemo(() => overview.resources.slice(0, 3), [overview.resources])

  // One read serves both the home timeline and the Incidents history.
  useEffect(() => {
    const controller = new AbortController()
    setHistoryError(null)
    setHistoryLoading(true)
    fetchMonitoringHistory(controller.signal)
      .then((events) => { setHistory(events); setHistoryLoading(false) })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setHistory([])
          setHistoryError('History unavailable')
          setHistoryLoading(false)
        }
      })
    return () => controller.abort()
  }, [historyRefresh])

  useEffect(() => {
    document.title = activeIncidents > 0 ? `(${activeIncidents}) ${baseTitle}` : baseTitle
  }, [activeIncidents])

  const orderedServices = useMemo(() => overview.services.slice().sort((a, b) => statusPriority(b.status) - statusPriority(a.status)), [overview.services])
  const preview = overview.mode === 'mock'

  useEffect(() => {
    if (isPhone) return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPhone])

  const askFromPalette = useCallback((prompt: string) => {
    setActive('FRIDAY')
    void friday.sendMessage(prompt)
  }, [friday])

  const paletteItems = useMemo<PaletteItem[]>(() => [
    ...[...nav, ...pendingNav].map(([label]) => ({
      id: `go-${label}`, group: 'Go to', label,
      hint: label === 'Incidents' && activeIncidents > 0 ? `${activeIncidents} active` : pendingNav.some(([name]) => name === label) ? 'not connected' : undefined,
      run: () => navigate(label),
    })),
    ...health.attention.concat(overview.services.filter((service) => !health.attention.includes(service))).map((service) => ({
      id: `svc-${service.id}`, group: 'Service', label: service.name, hint: `${service.host} · ${service.status}`,
      run: () => navigate('Infrastructure'),
    })),
    ...incidents.filter((incident) => incident.status === 'open').map((incident) => ({
      id: `inc-${incident.id}`, group: 'Incident', label: incident.serviceName || incident.title, hint: `${incident.severity} · ${incident.host || incident.source}`,
      run: () => viewDiagnosis(incident),
    })),
  ], [activeIncidents, health.attention, overview.services, incidents])

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
          <PwaControls/>
        </header>
        <main className="v3-main">
          {preview && <PreviewBanner/>}
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
            activity={<ActivityTimeline
              connected={connected}
              mode={overview.mode}
              events={history}
              examples={overview.activities}
              loading={historyLoading}
              error={historyError}
              onOpenIncidents={() => navigate('Incidents')}
              onRefresh={() => setHistoryRefresh((value) => value + 1)}
            />}
          /> : active === 'FRIDAY' ? <FridayWorkspace
            session={friday}
            query={query}
            onQueryChange={setQuery}
            onSubmit={submitFriday}
          /> : active === 'Agents' ? <AgentsWorkspace/> : active === 'Settings' ? <SettingsWorkspace/> : active === 'Tasks' ? <TasksWorkspace/> : active === 'Audit' ? <AuditWorkspace/> : active === 'Repositories' ? <RepositoriesWorkspace/> : active === 'Applications' ? <ApplicationsWorkspace overview={overview} connected={connected}/> : active === 'Infrastructure' ? <InfrastructureWorkspace overview={overview} connected={connected}/> : active === 'Incidents' ? <IncidentsWorkspace
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
        <nav>
          {nav.map(([label, Icon]) => <button key={label} aria-label={label} data-label={label} className={active === label ? 'active' : ''} onClick={() => navigate(label)} title={label}><Icon size={19}/>{label === 'Incidents' && activeIncidents > 0 && <i>{activeIncidents}</i>}</button>)}
          <hr aria-hidden="true"/>
          {pendingNav.map(([label, Icon]) => <button key={label} aria-label={label} data-label={`${label} · not connected`} className={`pending${active === label ? ' active' : ''}`} onClick={() => navigate(label)} title={`${label} · not connected`}><Icon size={19}/></button>)}
        </nav>
        <div className="v3-avatar">SM</div>
      </aside>

      <div className="v3-workspace">
        <header className="v3-topbar">
          <div><strong>FRIDAY</strong><span>AI OPERATIONS CONTROL</span></div>
          <button type="button" className="v3-search" onClick={() => setPaletteOpen(true)} aria-label="Search or command"><Search size={16}/><span>Search or command</span><kbd>Ctrl K</kbd></button>
          <div className="v3-topbar-actions">
            <div className={`v3-system ${live ? 'live' : 'unavailable'}`} role="status" aria-label="Live data status"><i /> {live ? 'READ-ONLY MONITORING' : 'LIVE STATUS UNAVAILABLE'}</div>
            <PwaControls/>
          </div>
        </header>

        <main className="v3-main">
          {preview && <PreviewBanner/>}
          <section className="v3-intro">
            <div><span className="v3-kicker">COMMAND CENTER / {active.toUpperCase()}</span><h1 className={selfTitled.has(active) ? 'v3-visually-hidden' : undefined}>{active === 'Overview' ? greeting() : active}</h1><p>{connected ? `API connected · ${overview.mode} mode` : 'Local preview data · safe read-only interface'}</p></div>
            <div className="v3-readonly-badge" role="status" aria-label="Automation execution status" title="Automation is unavailable for execution"><ShieldCheck size={15}/><span><b>Read only</b><small>Automation is unavailable for execution</small></span></div>
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
              <div className="v3-panel"><div className="v3-section-head"><div><span className="v3-kicker">TELEMETRY</span><h2>VM 100 · Infrastructure</h2></div>{live ? <span className="v3-live"><i/> LIVE</span> : <span className="v3-live sample"><i/> SAMPLE</span>}</div><div className="v3-metrics">{metrics.map((m, i) => <div key={m.label}><span>{i === 0 ? <Cpu/> : i === 1 ? <MemoryStick/> : <HardDrive/>}{m.label}</span><strong>{m.value}%</strong><div><i style={{width:`${m.value}%`}}/></div><small>{m.helper}</small></div>)}</div></div>
              <section className="v3-panel" aria-labelledby="v3-needs-attention"><div className="v3-section-head"><div><span className="v3-kicker">SERVICES</span><h2 id="v3-needs-attention">Needs attention</h2></div><button onClick={() => navigate('Infrastructure')}>View all services <ChevronRight size={15}/></button></div><div className="v3-agents">{health.attention.length ? health.attention.slice(0, 4).map((service) => <div key={service.id}><i className={service.status}/><span><b>{service.name}</b><small>{service.host} · {service.detail}</small></span><em className={service.status}>{statusLabel(service.status)}</em></div>) : <div><i className="on"/><span><b>No service issues</b><small>{!health.total ? 'No services observed yet.' : health.online === health.total ? 'Every observed service reports online.' : `${health.total - health.online} in maintenance · the rest report online.`}</small></span></div>}</div></section>
            </section>

            <ActivityTimeline
              connected={connected}
              mode={overview.mode}
              events={history}
              examples={overview.activities}
              loading={historyLoading}
              error={historyError}
              onOpenIncidents={() => navigate('Incidents')}
              onRefresh={() => setHistoryRefresh((value) => value + 1)}
            />

            <section className="v3-section" aria-labelledby="v3-service-health"><div className="v3-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2 id="v3-service-health">Service health</h2></div><span>{health.online} online</span></div><div className="v3-services">{orderedServices.map(s => <button key={s.id} onClick={() => navigate('Infrastructure')}><i className={s.status}/><span><b>{s.name}</b><small>{s.host}</small></span>{s.status === 'online' ? <em>{s.updated}</em> : <em className={`v3-service-state ${s.status}`}>{statusLabel(s.status)}</em>}</button>)}</div></section>
          </> : active === 'FRIDAY' ? <FridayWorkspace session={friday} query={query} onQueryChange={setQuery} onSubmit={submitFriday}/>
            : active === 'Agents' ? <AgentsWorkspace/>
            : active === 'Applications' ? <ApplicationsWorkspace overview={overview} connected={connected}/>
            : active === 'Repositories' ? <RepositoriesWorkspace/>
            : active === 'Audit' ? <AuditWorkspace/>
            : active === 'Settings' ? <SettingsWorkspace/>
            : active === 'Tasks' ? <TasksWorkspace/>
            : active === 'Infrastructure' ? <InfrastructureWorkspace overview={overview} connected={connected}/>
            : active === 'Incidents' ? <IncidentsWorkspace incidents={incidents} services={overview.services} sites={overview.sites} monitoring={overview.monitoring} history={history} historyError={historyError} selectedIncident={selectedIncident} onSelectIncident={viewDiagnosis} onClearSelection={() => setSelectedIncidentId(null)}/>
                        : <PendingCapabilityView name={active} />}
        </main>
      </div>
      <CommandPalette open={paletteOpen} items={paletteItems} onAsk={askFromPalette} onClose={() => setPaletteOpen(false)}/>
    </div>
  )
}

function PendingCapabilityView({ name }: { name: string }) {
  const details: Record<string, string> = {
    Tasks: 'The Phase 2B task and handoff services exist internally, but are not yet exposed through an authenticated, project-scoped production API.',
    Memory: 'Scoped persistent and short-lived memory services exist internally, but the production UI has no approved identity-bound memory API.',
    Approvals: 'The durable internal approval foundations are not a public approval queue. Signed identity, operator policy and audit must be connected first.',
  }
  return <section className="v3-pending-capability" aria-label={name + ' availability'}>
    <span className="v3-kicker">FRIDAY / RELEASE STATUS</span>
    <h2>{name} is not connected</h2>
    <p>{details[name] || 'This workspace has no production-backed service yet.'}</p>
    <p>No production task, memory or approval operation is available on this screen.</p>
    <div role="status">Not activated · read only · no action controls</div>
  </section>
}
