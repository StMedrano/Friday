import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, AppWindow, Bot, Boxes, CheckCircle2, ChevronRight, Command, Cpu, Database, Gauge, HardDrive, Home, MemoryStick, Network, Search, Server, Settings, ShieldCheck, Sparkles, TerminalSquare } from 'lucide-react'
import { askFridayAssistant, fetchMonitoringHistory, useFridayOverview, type FridayIncident, type MonitoringEvent } from '../lib/api'
import { usePhoneLayout } from '../hooks/usePhoneLayout'
import ActiveIncidents from '../components/ActiveIncidents'
import AssistantReply, { type AssistantReplyState } from '../components/AssistantReply'
import IncidentsWorkspace from '../components/IncidentsWorkspace'
import MobileHome from '../components/MobileHome'
import MobileNavigation from '../components/MobileNavigation'
import '../monitoring.css'
import '../mobile.css'

const nav = [
  ['Overview', Home], ['FRIDAY', Sparkles], ['Infrastructure', Server], ['Applications', AppWindow],
  ['Agents', Bot], ['Tasks', CheckCircle2], ['Approvals', ShieldCheck], ['Incidents', AlertTriangle],
  ['Memory', Database], ['Audit', Activity], ['Settings', Settings],
] as const

export default function Dashboard() {
  const { overview, connected } = useFridayOverview()
  const isPhone = usePhoneLayout()
  const [active, setActive] = useState('Overview')
  const [automation, setAutomation] = useState(true)
  const [query, setQuery] = useState('')
  const [assistant, setAssistant] = useState<AssistantReplyState>({
    text: 'Everything critical is operating normally. I am ready to inspect your infrastructure.',
    loading: false,
    error: null,
  })
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

  async function askFriday(e: React.FormEvent) {
    e.preventDefault()
    const text = query.trim()
    if (!text || assistant.loading) return

    setAssistant((current) => ({ ...current, loading: true, error: null }))
    try {
      const result = await askFridayAssistant(text)
      setAssistant({
        text: result.text || result.reason || 'Friday returned no response text.',
        mode: result.mode,
        provider: result.provider,
        model: result.model,
        loading: false,
        error: null,
      })
      setQuery('')
    } catch (error) {
      setAssistant((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Friday assistant unavailable',
      }))
    }
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
            assistant={assistant}
            onQueryChange={setQuery}
            onSubmit={askFriday}
            onNavigate={navigate}
            onSelectIncident={viewDiagnosis}
          /> : active === 'Incidents' ? <IncidentsWorkspace
            incidents={incidents}
            monitoring={overview.monitoring}
            history={history}
            historyError={historyError}
            selectedIncident={selectedIncident}
            onSelectIncident={viewDiagnosis}
            onClearSelection={() => setSelectedIncidentId(null)}
          /> : <DetailView active={active} overview={overview}/>} 
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
            <label className="v3-automation"><span><b>Automation</b><small>{automation ? 'Enabled · policy gated' : 'Disabled · read only'}</small></span><input type="checkbox" checked={automation} onChange={e => setAutomation(e.target.checked)}/><em /></label>
          </section>

          {active === 'Overview' || active === 'FRIDAY' ? <>
            <section className="v3-friday">
              <div className="v3-core-wrap"><div className="v3-ring r1"/><div className="v3-ring r2"/><div className="v3-core"><span/></div></div>
              <div className="v3-command">
                <span className="v3-kicker">FRIDAY / ONLINE</span>
                <h2>What would you like me to handle?</h2>
                <p>Ask about servers, applications, incidents, deployments, networking, logs, or system health.</p>
                <form onSubmit={askFriday}><Command size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask FRIDAY anything…" disabled={assistant.loading}/><button aria-label="Send command" disabled={assistant.loading}><ChevronRight size={18}/></button></form>
                <AssistantReply state={assistant} />
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
              <div className="v3-infra">
                {overview.services.slice(0, 3).map((service, idx) => <article key={service.id}>
                  <div className="v3-node-icon">{idx === 0 ? <Server/> : idx === 1 ? <Boxes/> : <Network/>}</div>
                  <div><span>{service.category.toUpperCase()}</span><h3>{service.name}</h3><p>{service.host} · {service.detail}</p></div>
                  <div className={`v3-status ${service.status}`}><i/>{service.status}</div>
                </article>)}
              </div>
            </section>

            <section className="v3-grid">
              <div className="v3-panel">
                <div className="v3-section-head"><div><span className="v3-kicker">TELEMETRY</span><h2>VM 100 · Infrastructure</h2></div><span className="v3-live"><i/> LIVE</span></div>
                <div className="v3-metrics">{metrics.map((m, i) => <div key={m.label}><span>{i === 0 ? <Cpu/> : i === 1 ? <MemoryStick/> : <HardDrive/>}{m.label}</span><strong>{m.value}%</strong><div><i style={{width:`${m.value}%`}}/></div><small>{m.helper}</small></div>)}</div>
              </div>
              <div className="v3-panel">
                <div className="v3-section-head"><div><span className="v3-kicker">AGENT MESH</span><h2>Active agents</h2></div><Bot size={18}/></div>
                <div className="v3-agents">
                  <div><i className="on"/><span><b>Monitoring</b><small>Watching system health</small></span><em>ACTIVE</em></div>
                  <div><i className="on"/><span><b>Infrastructure</b><small>Inventory synchronized</small></span><em>READY</em></div>
                  <div><i/><span><b>Security</b><small>Policy engine ready</small></span><em>IDLE</em></div>
                </div>
              </div>
            </section>

            <section className="v3-section">
              <div className="v3-section-head"><div><span className="v3-kicker">APPLICATIONS</span><h2>Service health</h2></div><span>{online} online</span></div>
              <div className="v3-services">{overview.services.map(s => <button key={s.id} onClick={() => navigate('Applications')}><i className={s.status}/><span><b>{s.name}</b><small>{s.host}</small></span><em>{s.updated}</em></button>)}</div>
            </section>
          </> : active === 'Incidents' ? <IncidentsWorkspace
            incidents={incidents}
            monitoring={overview.monitoring}
            history={history}
            historyError={historyError}
            selectedIncident={selectedIncident}
            onSelectIncident={viewDiagnosis}
            onClearSelection={() => setSelectedIncidentId(null)}
          /> : <DetailView active={active} overview={overview} />}
        </main>
      </div>
    </div>
  )
}

function DetailView({ active, overview }: { active: string, overview: ReturnType<typeof useFridayOverview>['overview'] }) {
  return <section className="v3-detail">
    <div className="v3-detail-hero"><div className="v3-node-icon large">{active === 'Infrastructure' ? <Server/> : active === 'Applications' ? <AppWindow/> : active === 'Agents' ? <Bot/> : <TerminalSquare/>}</div><div><span className="v3-kicker">FRIDAY CONTROL PLANE</span><h2>{active}</h2><p>Operational view backed by the existing FRIDAY read-only API boundary.</p></div></div>
    <div className="v3-detail-grid">
      <article><Gauge/><strong>{overview.services.length}</strong><span>Tracked services</span></article>
      <article><ShieldCheck/><strong>{overview.mode.toUpperCase()}</strong><span>Control mode</span></article>
      <article><Activity/><strong>{overview.activities.length}</strong><span>Recent events</span></article>
    </div>
    <div className="v3-panel v3-list"><div className="v3-section-head"><div><span className="v3-kicker">CURRENT STATE</span><h2>Environment inventory</h2></div></div>
      {overview.services.map(s => <div className="v3-list-row" key={s.id}><i className={s.status}/><span><b>{s.name}</b><small>{s.site} · {s.host}</small></span><p>{s.detail}</p><em>{s.status}</em></div>)}
    </div>
  </section>
}
