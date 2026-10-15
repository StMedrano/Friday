import { Activity, ArrowUpRight, Clock3 } from 'lucide-react'
import type { MonitoringEvent } from '../lib/api'
import type { ActivityItem } from '../lib/infrastructure'

type ActivityTimelineProps = {
  connected: boolean
  mode: 'live' | 'mock'
  events: MonitoringEvent[]
  examples: ActivityItem[]
  loading: boolean
  error: string | null
  onOpenIncidents: () => void
}

function eventTitle(type: string): string {
  return type.replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase()).slice(0, 100) || 'Monitoring event'
}

function observedTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unavailable'
}

export default function ActivityTimeline({
  connected, mode, events, examples, loading, error, onOpenIncidents,
}: ActivityTimelineProps) {
  const showLive = connected && mode === 'live'
  const showMock = connected && mode === 'mock'
  const history = events
    .filter(event => Number.isFinite(Date.parse(event.at)))
    .slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5)
  return <section className="v3-activity-panel" aria-label="Operational activity timeline">
    <div className="v3-activity-heading">
      <div><span className="v3-kicker">MONITORING HISTORY</span><h2>Recent activity</h2></div>
      {showLive && <button type="button" onClick={onOpenIncidents} aria-label="Open monitoring history">
        View history <ArrowUpRight size={15}/>
      </button>}
    </div>
    <div className="v3-activity-provenance">
      <Activity size={14} aria-hidden="true"/>
      {showLive ? 'Observed data' : showMock ? 'Demo examples' : 'Preview only — not connected to Friday'}
    </div>
    {showLive ? loading ? <p className="v3-activity-empty" role="status">Loading monitoring history…</p>
      : error ? <p className="v3-activity-empty" role="status">{['Monitoring disabled','Monitoring history response invalid'].includes(error) ? error : 'Monitoring history unavailable'}</p>
      : history.length ? <ol className="v3-activity-items" aria-label="Recent monitoring events">
        {history.map(event => <li key={event.id} className="v3-activity-item">
          <span className="v3-activity-mark" aria-hidden="true"/>
          <div className="v3-activity-info">
            <strong>{eventTitle(event.type)}</strong>
            <p>{event.detail}</p>
            <small>{[event.serviceName, event.host, event.source].filter(Boolean).join(' · ')}</small>
          </div>
          <time dateTime={event.at}><Clock3 size={12} aria-hidden="true"/>{observedTime(event.at)}</time>
        </li>)}
      </ol> : <p className="v3-activity-empty" role="status">No monitoring events recorded</p>
      : showMock ? examples.length ? <ol className="v3-activity-items" aria-label="Demo activity examples">
        {examples.slice(0, 5).map(example => <li key={example.id} className="v3-activity-item">
          <span className="v3-activity-mark demo" aria-hidden="true"/>
          <div className="v3-activity-info"><strong>{example.title}</strong><p>{example.detail}</p><small>Example only · not a live event</small></div>
          <span className="v3-activity-demo-time">{example.time}</span>
        </li>)}
      </ol> : <p className="v3-activity-empty" role="status">No demo examples available</p>
      : <p className="v3-activity-empty" role="status">Connect to Friday to view monitoring history.</p>}
  </section>
}
