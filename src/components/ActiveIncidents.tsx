import { AlertTriangle, Clock3, FileSearch, ShieldAlert } from 'lucide-react'
import type { FridayIncident } from '../lib/api'

const severityRank = { high: 0, warning: 1, info: 2 } as const

function since(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function ActiveIncidents({
  incidents,
  onSelectIncident,
}: {
  incidents: FridayIncident[]
  onSelectIncident?: (incident: FridayIncident) => void
}) {
  const active = incidents
    .filter((incident) => incident.status === 'open')
    .slice()
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.openedAt.localeCompare(a.openedAt))

  return <section className="v3-section v3-incidents" aria-label="Active incidents">
    <div className="v3-section-head">
      <div><span className="v3-kicker">INCIDENT RESPONSE / READ ONLY</span><h2>Active incidents</h2></div>
      <span>{active.length} open</span>
    </div>
    {active.length === 0 ? <div className="v3-incident-empty"><ShieldAlert size={18}/><div><b>No active incidents</b><span>Monitoring has no open operational incidents to surface.</span></div></div> :
      <div className="v3-incident-stack">{active.map((incident) => <article className={`v3-incident-card ${incident.severity}`} key={incident.id}>
        <div className="v3-incident-icon"><AlertTriangle size={18}/></div>
        <div className="v3-incident-body">
          <div className="v3-incident-title"><span className={`v3-severity ${incident.severity}`}>{incident.severity.toUpperCase()}</span><b>{incident.serviceName || incident.title}</b><em>{incident.host || incident.source}</em></div>
          <p>{incident.detail}</p>
          <div className="v3-incident-evidence"><Clock3 size={13}/><span>First seen {since(incident.firstSeen)}</span>{incident.evidence?.[0] && <span>Evidence: {incident.evidence[0]}</span>}</div>
          <div className="v3-recommendation"><strong>Recommended next step</strong><p>{incident.recommendedAction}</p></div>
          {onSelectIncident && <button className="v3-readonly-action v3-diagnosis-link" onClick={() => onSelectIncident(incident)}><FileSearch size={14}/> View Diagnosis</button>}
        </div>
        <div className="v3-incident-policy"><span>READ ONLY</span><strong>REQUIRES APPROVAL TO ACT</strong></div>
      </article>)}</div>}
  </section>
}
