import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AppWindow, Bot, Boxes, CheckCircle2, ChevronRight, Cpu, Database, Gauge, HardDrive, Home, MemoryStick, Network, Search, Server, Settings, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react'
import { fetchFridayAgentGroups, fetchMonitoringHistory, useFridayOverview, type GroupWorkspace, type FridayIncident, type MonitoringEvent } from '../lib/api'
import { useFridaySession } from '../hooks/useFridaySession'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import ActiveIncidents from '../components/ActiveIncidents'
import AgentsWorkspace from '../components/AgentsWorkspace'
import FridayComposer from '../components/FridayComposer'
import FridayConversation from '../components/FridayConversation'
import FridayWorkspace from '../components/FridayWorkspace'
import IncidentsWorkspace from '../components/IncidentsWorkspace'
import MobileHome from '../components/MobileHome'
import MobileNavigation from '../components/MobileNavigation'
import '../monitoring.css'
import '../mobile.css'
import '../assistant.css'
import '../agents.css'

const nav = [
  ['Overview', Home], ['FRIDAY', Sparkles], ['Infrastructure', Server], ['Applications', AppWindow],
  ['Agents', Bot], ['Tasks', CheckCircle2], ['Approvals', ShieldCheck], ['Incidents', AlertTriangle],
  ['Memory', Database], ['Audit', Activity], ['Settings', Settings],
] as const

export default function Dashboard() {
  const { overview, connected } = useFridayOverview()
  const friday = useFridaySession()
  const isPhone = usePhoneLayout()
  const [active, setActive] = useState('Overview')
  const [groups, setGroups] = useState<GroupWorkspace | null>(null)
  const [groupsUnavailable, setGroupsUnavailable] = useState(false)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<MonitoringEvent[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const online = overview.services.filter(s => s.status === 'online').length
  const health = Math.round((online / Math.max(overview.services.length, 1)) * 100)
  const incidents = overview.incidents ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null
  const activeIncidents = overview.monitoring?.activeIncidents ?? incidents.filter((incident) => incident.status === 'open').length
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

  useEffect(() => {
    if (active !== 'Overview') return
    const controller = new AbortController()
    setGroups(null)
    setGroupsUnavailable(false)
    fetchFridayAgentGroups(controller.signal)
      .then(data => { if (!controller.signal.aborted) setGroups(data) })
      .catch(() => { if (!controller.signal.aborted) setGroupsUnavailable(true) })
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
          <div role="status">Actions not enabled</div>
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
          /> : active === 'Agents' ? <AgentsWorkspace/> : active === 'Incidents' ? <IncidentsWorkspace
            incidents={incidents}
            monitoring={overview.monitoring}
            history={history}
            historyError={historyError}
            selectedIncident={selectedIncident}
            onSelectIncident={viewDiagnosis}
            onClearSelection={() => setSelectedIncidentId(null)}
          /> : <DetailView active={active} overview={overview}/>} 
          {active === 'Overview' && <AgentConfiguration groups={groups} unavailable={groupsUnavailable} onNavigate={() => navigate('Agents')}/> }
        </main>
      </div>
      <MobileNavigation active={active} activeIncidents={activeIncidents} onNavigate={navigate}/>
    </div>
  }

  return (
    <div className="v3-shell">
      <aside className="v3-rail">
        <button className="v3-logo" onClick={() => navigate('Overview')} aria-label="FRIDAY home"><span /></button>
        <nav>{nav.map(([label, Icon]) => <button key={label} className={active === label ? 'active' : ''} onClick={() => navigate(label)} title={label}><Icon size={19}/>{label === 'Approvals' && <i>2</i>}{label === 'Incidents' && activeIncidents > 0 && <i>{activeIncidents}</i>}</button>)}</nav>
        <div className="v3-avatar">SM</div>
      </aside>

      <div className="v3-workspace">
        <header className="v3-topbar">
          <div><strong>FRIDAY</strong><span>AI OPERATIONS CONTROL</span></div>
          <button className="v3-search"><Search size={16}/><span>Search or command</span><kbd>Ctrl K</kbd></button>
          <div className="v3-system"><i /> SYSTEM OPERATIONAL</div>
        </header>

        <main className="v3-main">
          <section className="v3-intro">
            <div><span className="v3-kicker">COMMAND CENTER / {active.toUpperCase()}</span><h1>{active === 'Overview' ? 'Good afternoon.' : active}</h1><p>{connected ? `API connected · ${overview.mode} mode` : 'Local preview data · safe read-only interface'}</p></div>
            <div className="v3-automation" role="status">Actions not enabled</div>
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
              <div className="v3-health">
                <span className="v3-kicker">SYSTEM HEALTH</span>
                <div className="v3-health-score"><strong>{health}%</strong><span>{activeIncidents > 0 ? 'ATTENTION' : 'NOMINAL'}</span></div>
                <div className="v3-health-row"><span>Services</span><b>{online}/{overview.services.length}</b></div>
                <div className="v3-health-row"><span>Active incidents</span><b>{activeIncidents}</b></div>
                <div className="v3-health-row"><span>Sites</span><b>{overview.sites.length}</b></div>
              </div>
            </section>

            <ActiveIncidents incidents={incidents} onSelectIncident={viewDiagnosis}/>

            <section className="v3-section">
              <div className="v3-section-head"><div><span className="v3-kicker">SYSTEM</span><h2>Infrastructure</h2></div><button onClick={() => navigate('Infrastructure')}>View topology <ChevronRight size={15}/></button></div>
              <div className="v3-infra">{overview.services.slice(0, 3).map((service, idx) => <article key={service.id}><div className="v3-node-icon">{idx === 0 ? <Server/> : idx === 1 ? <Boxes/> : <Network/>}</div><div><span>{service.category.toUpperCase()}</span><h3>{service.name}</h3><p>{service.host} · {service.detail}</p></div><div className={`v3-status ${service.status}`}><i/>{service.status}</div></article>)}</div>
            </section>

            <section className="v3-grid">
              <div className="v3-panel"><div className="v3-section-head"><div><span className="v3-kicker">TELEMETRY</span><h2>VM 100 · Infrastructure</h2></div><span className="v3-live"><i/> LIVE</span></div><div className="v3-metrics">{metrics.map((m, i) => <div key={m.label}><span>{i === 0 ? <Cpu/> : i === 1 ? <MemoryStick/> : <HardDrive/>}{m.label}</span><strong>{m.value}%</strong><div><i style={{width:`${m.value}%`}}/></div><small>{m.helper}</small></div>)}</div></div>
              <AgentConfiguration groups={groups} unavailable={groupsUnavailable} onNavigate={() => navigate('Agents')}/>
            </section>

            <section className="v3-section"><div className="v3-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2>Service health</h2></div><span>{online} online</span></div><div className="v3-services">{overview.services.map(s => <button key={s.id} onClick={() => navigate('Applications')}><i className={s.status}/><span><b>{s.name}</b><small>{s.host}</small></span><em>{s.updated}</em></button>)}</div></section>
          </> : active === 'FRIDAY' ? <FridayWorkspace session={friday} query={query} onQueryChange={setQuery} onSubmit={submitFriday}/>
            : active === 'Agents' ? <AgentsWorkspace/>
            : active === 'Incidents' ? <IncidentsWorkspace incidents={incidents} monitoring={overview.monitoring} history={history} historyError={historyError} selectedIncident={selectedIncident} onSelectIncident={viewDiagnosis} onClearSelection={() => setSelectedIncidentId(null)}/>
            : <DetailView active={active} overview={overview} />}
        </main>
      </div>
    </div>
  )
}

function DetailView({ active, overview }: { active: string, overview: ReturnType<typeof useFridayOverview>['overview'] }) {
  return <section className="v3-detail">
    <div className="v3-detail-hero"><div className="v3-node-icon large">{active === 'Infrastructure' ? <Server/> : active === 'Applications' ? <AppWindow/> : active === 'Agents' ? <Bot/> : <TerminalSquare/>}</div><div><span className="v3-kicker">FRIDAY CONTROL PLANE</span><h2>{active}</h2><p>Operational view backed by the existing FRIDAY read-only API boundary.</p></div></div>
    <div className="v3-detail-grid"><article><Gauge/><strong>{overview.services.length}</strong><span>Tracked services</span></article><article><ShieldCheck/><strong>{overview.mode.toUpperCase()}</strong><span>Control mode</span></article><article><Activity/><strong>{overview.activities.length}</strong><span>Recent events</span></article></div>
    <div className="v3-panel v3-list"><div className="v3-section-head"><div><span className="v3-kicker">CURRENT STATE</span><h2>Environment inventory</h2></div></div>{overview.services.map(s => <div className="v3-list-row" key={s.id}><i className={s.status}/><span><b>{s.name}</b><small>{s.site} · {s.host}</small></span><p>{s.detail}</p><em>{s.status}</em></div>)}</div>
  </section>
}

function AgentConfiguration({ groups, unavailable, onNavigate }: {
  groups: GroupWorkspace | null; unavailable: boolean; onNavigate: () => void
}) {
  const configured = new Set(groups?.groups.flatMap(group => group.members
    .filter(member => member.state === 'configured' && member.agentId !== null)
    .map(member => member.agentId))).size
  return <section className="v3-panel" aria-label="Agent configuration">
    <div className="v3-section-head"><div><span className="v3-kicker">GROUP WORKSPACE</span><h2>Agent configuration</h2></div><Bot size={18}/></div>
    <div className="v3-agents">
      <div><span><b>{unavailable || groups?.registryStatus === 'unavailable'
        ? 'Agent configuration unavailable' : groups
          ? `${configured} configured member${configured === 1 ? '' : 's'}`
          : 'Loading agent configuration…'}</b><small>Configured does not mean running.</small></span></div>
      <div><span><b>Work integration not connected.</b></span></div>
    </div>
    <div className="v3-section-head"><button type="button" onClick={onNavigate}>View Agents configuration <ChevronRight size={15}/></button></div>
  </section>
}
