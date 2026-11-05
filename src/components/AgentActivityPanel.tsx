import { useEffect, useState } from 'react'
import NotConnected from './NotConnected'
import { fetchFridayAgentActivity, type FridayAgentActivityResult } from '../lib/api'

const OUTCOME: Record<string, { label: string; tone: string }> = {
  answered: { label: 'Answered', tone: '' },
  unavailable: { label: 'Unavailable', tone: 'warning' },
  'not-found': { label: 'Unknown agent', tone: 'warning' },
  failed: { label: 'Failed', tone: 'critical' },
}
const REFRESH_MS = 60_000
const SHOWN = 8

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Recent agent questions from Friday's metadata-only activity log: which agent,
 * which model, the outcome and how long it took. Prompts and answers are not stored.
 * `refreshKey` changes after each question asked on this page so the list updates.
 */
export default function AgentActivityPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [activity, setActivity] = useState<FridayAgentActivityResult | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const load = () => fetchFridayAgentActivity(controller.signal)
      .then((result) => { if (!controller.signal.aborted) setActivity(result) })
      .catch(() => { if (!controller.signal.aborted) setActivity({ state: 'unavailable' }) })
    void load()
    const timer = setInterval(() => { void load() }, REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refreshKey])

  if (!activity || activity.state === 'disabled') {
    return <NotConnected title="Live agent events" detail="Agent questions are listed here once the agent activity log (FRIDAY_AGENT_ACTIVITY_ENABLED) is on."/>
  }
  if (activity.state === 'unavailable') return <p className="fx-activity-note" role="status">Agent activity could not be loaded.</p>
  return <section className="fx-agent-activity" aria-label="Live agent events">
    <h3>Live agent events</h3>
    {activity.events.length === 0 ? <p className="fx-activity-note">No agent questions recorded yet.</p>
      : <ul>{activity.events.slice(0, SHOWN).map((event) => {
        const outcome = OUTCOME[event.outcome] || { label: event.outcome, tone: 'warning' }
        return <li key={event.id}>
          <span className="fx-agent-activity-head"><b>{event.agentName || event.agentId}</b><span className={`fx-status ${outcome.tone}`}>{outcome.label}</span></span>
          <small>{when(event.at)}{event.model ? ` · ${event.model}` : ''} · {(event.durationMs / 1000).toFixed(1)}s{event.reason === 'grounding-invalid' ? ' · answer failed grounding check' : ''}</small>
        </li>
      })}</ul>}
    <p className="fx-activity-note">Metadata only. Questions and answers are not stored.</p>
  </section>
}
