import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AppWindow, Bot, Boxes, CheckCircle2, ChevronRight, Cpu, Database, FolderGit2, Gauge, HardDrive, Home, MemoryStick, Network, PanelLeftClose, PanelLeftOpen, Search, Server, Settings, ShieldCheck, Sparkles, TerminalSquare, X } from 'lucide-react'
import { fetchFridayAgentGroups, fetchMonitoringHistory, useFridayOverview, type GroupWorkspace, type FridayIncident, type MonitoringEvent } from '../lib/api'
import { useFridaySession } from '../hooks/useFridaySession'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import { useModalFocus } from '../hooks/useModalFocus'
import ActiveIncidents from '../components/ActiveIncidents'
import ProjectTasksWorkspace from '../components/ProjectTasksWorkspace'
import ActivityTimeline from '../components/ActivityTimeline'
import AgentsWorkspace from '../components/AgentsWorkspace'
import FridayComposer from '../components/FridayComposer'
import FridayConversation from '../components/FridayConversation'
import FridayWorkspace from '../components/FridayWorkspace'
import IncidentsWorkspace from '../components/IncidentsWorkspace'
import MobileHome from '../components/MobileHome'
import MobileNavigation from '../components/MobileNavigation'
import RepositoriesWorkspace from '../components/RepositoriesWorkspace'
import '../monitoring.css'
import '../mobile.css'
import '../assistant.css'
import '../agents.css'
import '../repositories.css'

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
  const [groups, setGroups] = useState<GroupWorkspace | null>(null)
  const [groupsUnavailable, setGroupsUnavailable] = useState(false)
  const [query, setQuery] = useState('')
  const [railExpanded, setRailExpanded] = useState(true)
  const [commandOpen, setCommandOpen] = useState(false)
  const {dialogRef:commandDialogRef,rememberFocus}=useModalFocus(commandOpen,isPhone,()=>setCommandOpen(false))
  const [commandQuery, setCommandQuery] = useState('')
  const [history, setHistory] = useState<MonitoringEvent[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const online = overview.services.filter(s => s.status === 'online').length
  const health = Math.round((online / Math.max(overview.services.length, 1)) * 100)
  const incidents = overview.incidents ?? []
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId) ?? null
  const activeIncidents = overview.monitoring?.activeIncidents ?? incidents.filter((incident) => incident.status === 'open').length
  const metrics = useMemo(() => overview.resources.slice(0, 3), [overview.resources])
  const commandResults = nav.filter(([label]) => label.toLowerCase().includes(commandQuery.trim().toLowerCase()))

  function openCommandPalette(){
    rememberFocus()
    setCommandQuery('')
    setCommandOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if(commandOpen)setCommandOpen(false)
        else openCommandPalette()
      } else if (event.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commandOpen])

  useEffect(() => {
    // Share one authenticated history read across Home and Incidents navigation.
    if (!connected || overview.mode !== 'live') {
      setHistory([])
      setHistoryLoading(false)
      setHistoryError(connected ? 'Demo mode — live monitoring history is not connected' : 'Monitoring history unavailable')
      return
    }
    const controller = new AbortController()
    setHistory([])
    setHistoryLoading(true)
    setHistoryError(null)
    fetchMonitoringHistory(controller.signal)
      .then(data => { if (!controller.signal.aborted) setHistory(data) })
      .catch(error => {
        if (error?.name !== 'AbortError' && !controller.signal.aborted) {
          setHistory([])
          setHistoryError(['Monitoring disabled','Monitoring history response invalid'].includes(error?.message) ? error.message : 'Monitoring history unavailable')
        }
      })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [connected, overview.mode,historyRefresh])

  const refreshHistory=connected&&overview.mode==='live'?()=>setHistoryRefresh(value=>value+1):undefined

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
    setCommandOpen(false)
    setCommandQuery('')
    setActive(destination)
    if (destination !== 'Incidents') setSelectedIncidentId(null)
  }

  function viewDiagnosis(incident: FridayIncident) {
    setSelectedIncidentId(incident.id)
    setActive('Incidents')
  }

  const palette = commandOpen ? <div className="v3-command-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) setCommandOpen(false)
  }}>
    <section ref={commandDialogRef} className="v3-command-dialog" role="dialog" aria-modal="true" aria-label="Friday command palette">
      <div className="v3-command-search-row">
        <Search size={18} aria-hidden="true"/>
        <input autoFocus aria-label="Search Friday views" placeholder="Search Friday workspaces…" value={commandQuery} onChange={event => setCommandQuery(event.target.value)}/>
        <button type="button" onClick={() => setCommandOpen(false)} aria-label="Close search"><X size={18}/></button>
      </div>
      <div className="v3-command-results">
        {commandResults.length ? commandResults.map(([label, Icon]) => <button type="button" key={label} onClick={() => navigate(label)} aria-label={`Open ${label}`}>
          <Icon size={18}/><span>{label}</span><ChevronRight size={15} aria-hidden="true"/>
        </button>) : <p role="status">No matching Friday workspace.</p>}
      </div>
      <p className="v3-command-help">Navigate existing views only. Infrastructure actions are not enabled.</p>
    </section>
  </div> : null

  if (isPhone) {
    return <div className="v3-shell v3-phone-shell">
      <div className="v3-workspace">
        <header className="v3-mobile-header">
          <div className="v3-mobile-brand"><span className="v3-live-dot"/><strong>FRIDAY</strong><small>AI OPERATIONS</small></div>
          <div className="v3-mobile-head-actions"><button type="button" className="v3-mobile-search-button" aria-label="Search Friday views" onClick={openCommandPalette}><Search size={18}/></button><div className={`v3-mobile-status ${connected ? 'online' : 'warning'}`}><i/>{connected ? (overview.mode === 'mock' ? 'DEMO' : 'CONNECTED') : 'PREVIEW'}</div></div>
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
            activityEvents={history}
            activityLoading={historyLoading}
            activityError={historyError} onRefreshHistory={refreshHistory}
          /> : active === 'FRIDAY' ? <FridayWorkspace
            session={friday}
            query={query}
            onQueryChange={setQuery}
            onSubmit={submitFriday}
          /> : active === 'Agents' ? <AgentsWorkspace/> : active === 'Tasks' ? <ProjectTasksWorkspace/> : active === 'Repositories' ? <RepositoriesWorkspace/> : active === 'Incidents' ? <IncidentsWorkspace
            incidents={incidents}
            monitoring={overview.monitoring}
            history={history}
            historyError={historyError} historyLoading={historyLoading} onRefreshHistory={refreshHistory}
            selectedIncident={selectedIncident}
            onSelectIncident={viewDiagnosis}
            onClearSelection={() => setSelectedIncidentId(null)}
          /> : <DetailView active={active} overview={overview}/>} 
          {active === 'Overview' && <AgentConfiguration groups={groups} unavailable={groupsUnavailable} onNavigate={() => navigate('Agents')}/> }
        </main>
      </div>
      <MobileNavigation active={active} activeIncidents={activeIncidents} onNavigate={navigate}/>
      {palette}
    </div>
  }

  return (
    <div className={`v3-shell ${railExpanded ? "v3-shell-expanded" : ""}`}>
      <aside className={`v3-rail ${railExpanded ? "expanded" : ""}`}>
        <button className="v3-logo" onClick={() => navigate('Overview')} aria-label="FRIDAY home"><span /><strong className="v3-logo-label">Friday</strong></button>
        <nav aria-label="Friday workspaces">{nav.map(([label, Icon]) => <button type="button" key={label} className={active === label ? 'active' : ''} aria-label={label} aria-current={active === label ? 'page' : undefined} onClick={() => navigate(label)} title={label}><Icon size={19}/><span className="v3-rail-label">{label}</span>{label === 'Incidents' && activeIncidents > 0 && <i>{activeIncidents}</i>}</button>)}</nav>
        <button type="button" className="v3-rail-toggle" onClick={() => setRailExpanded(open => !open)} aria-label={railExpanded ? 'Collapse navigation' : 'Expand navigation'}>
          {railExpanded ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}<span className="v3-rail-label">{railExpanded ? 'Collapse' : 'Expand'}</span>
        </button>
        <div className="v3-avatar" aria-label="Operator initials">SM</div>
      </aside>

      <div className="v3-workspace">
        <header className="v3-topbar">
          <div><strong>FRIDAY</strong><span>AI OPERATIONS CONTROL</span></div>
          <button type="button" className="v3-search" aria-label="Search or command" onClick={openCommandPalette}><Search size={16}/><span>Search or command</span><kbd>Ctrl K</kbd></button>
          <div className="v3-system"><i /> {connected ? (overview.mode === 'mock' ? 'DEMO DATA' : 'API CONNECTED') : 'DATA UNAVAILABLE'}</div>
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

            <ActivityTimeline connected={connected} mode={overview.mode} events={history} examples={overview.activities} loading={historyLoading} error={historyError} onRefresh={refreshHistory} onOpenIncidents={() => navigate('Incidents')}/>

            <section className="v3-section"><div className="v3-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2>Service health</h2></div><span>{online} online</span></div><div className="v3-services">{overview.services.map(s => <button key={s.id} onClick={() => navigate('Applications')}><i className={s.status}/><span><b>{s.name}</b><small>{s.host}</small></span><em>{s.updated}</em></button>)}</div></section>
          </> : active === 'FRIDAY' ? <FridayWorkspace session={friday} query={query} onQueryChange={setQuery} onSubmit={submitFriday}/>
            : active === 'Agents' ? <AgentsWorkspace/>
            : active === 'Tasks' ? <ProjectTasksWorkspace/>
            : active === 'Repositories' ? <RepositoriesWorkspace/>
            : active === 'Incidents' ? <IncidentsWorkspace incidents={incidents} monitoring={overview.monitoring} history={history} historyError={historyError} historyLoading={historyLoading} onRefreshHistory={refreshHistory} selectedIncident={selectedIncident} onSelectIncident={viewDiagnosis} onClearSelection={() => setSelectedIncidentId(null)}/>
            : <DetailView active={active} overview={overview} />}
        </main>
      </div>
      {palette}
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
    {groups && groups.registryStatus !== 'unavailable' && <div className="v3-group-quick-links" aria-label="Agent groups">
      {groups.groups.map(group => {
        const configuredCount = new Set(group.members.filter(member => member.state === 'configured' && member.agentId).map(member => member.agentId)).size
        const plannedCount = group.members.filter(member => member.implementation === 'planned').length
        return <button type="button" key={group.id} aria-label={`Open ${group.name} group`} onClick={onNavigate}>
          <span className="v3-group-letter" aria-hidden="true">{group.name.slice(0, 1)}</span>
          <span className="v3-group-summary"><strong>{group.name}</strong><small>{configuredCount} configured · {plannedCount} planned</small></span>
          <ChevronRight size={16} aria-hidden="true"/>
        </button>
      })}
    </div>}
    <div className="v3-section-head"><button type="button" onClick={onNavigate}>View Agents configuration <ChevronRight size={15}/></button></div>
  </section>
}
