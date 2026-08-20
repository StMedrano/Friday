import { Activity, ArrowLeft, CheckCircle2, Radar, ShieldCheck } from 'lucide-react'
import type { FridayIncident, MonitoringEvent, MonitoringSummary } from '../lib/api'
import ActiveIncidents from './ActiveIncidents'
import IncidentDetail from './IncidentDetail'

function displayTime(value: string | null | undefined) {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function IncidentsWorkspace({
  incidents,
  monitoring,
  history,
  historyError,
  selectedIncident,
  onSelectIncident,
  onClearSelection,
}: {
  incidents: FridayIncident[]
  monitoring?: MonitoringSummary | null
  history: MonitoringEvent[]
  historyError?: string | null
  selectedIncident?: FridayIncident | null
  onSelectIncident?: (incident: FridayIncident) => void
  onClearSelection?: () => void
}) {
  const resolved = incidents.filter((incident) => incident.status === 'resolved').slice().sort((a, b) => String(b.resolvedAt || '').localeCompare(String(a.resolvedAt || '')))
  const monitoringStatus = monitoring?.status || 'disabled'

  return <section className="v3-detail v3-incidents-workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><Radar/></div>
      <div><span className="v3-kicker">FRIDAY MONITORING / READ ONLY</span><h2>Incidents</h2><p>Detect, diagnose, and recommend. Infrastructure-changing actions are not available in this workspace.</p></div>
    </div>

    <div className="v3-monitoring-strip">
      <article><ShieldCheck/><span><b>Monitoring {monitoringStatus.toUpperCase()}</b><small>{monitoring?.lastError || 'Read-only health evaluation is operating within policy.'}</small></span></article>
      <article><Activity/><span><b>{monitoring?.activeIncidents ?? incidents.filter((incident) => incident.status === 'open').length} active incidents</b><small>Last poll: {displayTime(monitoring?.lastPollAt)}</small></span></article>
      <article><CheckCircle2/><span><b>{resolved.length} resolved</b><small>Resolution history is retained in FRIDAY-owned monitoring state.</small></span></article>
    </div>

    <ActiveIncidents incidents={incidents} onSelectIncident={onSelectIncident}/>

    {selectedIncident && <section className="v3-selected-diagnosis" aria-label="Selected incident diagnosis">
      {onClearSelection && <button className="v3-readonly-action v3-diagnostic-back" onClick={onClearSelection}><ArrowLeft size={15}/> Back to incidents</button>}
      <IncidentDetail incident={selectedIncident}/>
    </section>}

    <section className="v3-section">
      <div className="v3-section-head"><div><span className="v3-kicker">RECOVERY</span><h2>Recently resolved</h2></div><span>{resolved.length} recorded</span></div>
      <div className="v3-panel v3-incident-history-list">
        {resolved.length === 0 ? <div className="v3-history-empty">No resolved incidents have been recorded yet.</div> : resolved.map((incident) => <div className="v3-history-row" key={incident.id}>
          <CheckCircle2 size={16}/><span><b>{incident.serviceName || incident.title}</b><small>{incident.host || incident.source}</small></span><em>{incident.severity.toUpperCase()}</em><p>Resolved {displayTime(incident.resolvedAt)}</p>
        </div>)}
      </div>
    </section>

    <section className="v3-section">
      <div className="v3-section-head"><div><span className="v3-kicker">MONITORING AUDIT</span><h2>Health history</h2></div><span>{history.length} recent events</span></div>
      <div className="v3-panel v3-incident-history-list">
        {historyError ? <div className="v3-history-error">{historyError}</div> : history.length === 0 ? <div className="v3-history-empty">No monitoring history is available yet.</div> : history.map((event) => <div className="v3-history-row" key={event.id}>
          <Activity size={16}/><span><b>{event.detail}</b><small>{event.serviceName || event.source}{event.host ? ` · ${event.host}` : ''}</small></span><em>{event.type.replaceAll('-', ' ')}</em><p>{displayTime(event.at)}</p>
        </div>)}
      </div>
    </section>
  </section>
}
