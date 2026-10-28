import { useEffect, useState } from 'react'
import { ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react'
import { fetchFridayAuditEvents, FridayAuditError, type FridayAuditEvent } from '../lib/api'

const ACTION_LABELS: Record<string, string> = {
  'agents.registry.sync': 'Registry sync',
  'incidents.diagnostics.rerun': 'Diagnostic rerun',
  'settings.sites.update': 'Site settings update',
  'settings.endpoints.create': 'Endpoint check created',
  'settings.endpoints.update': 'Endpoint check edited',
  'settings.endpoints.delete': 'Endpoint check deleted',
}
const PHASE_LABELS: Record<string, string> = { requested: 'Requested', succeeded: 'Succeeded', failed: 'Failed', denied: 'Denied' }

function failureMessage(reason: unknown) {
  if (reason instanceof FridayAuditError) {
    if (reason.code === 'audit-not-enabled') return 'Action audit is not enabled on this controller. Set FRIDAY_AUDIT_ENABLED=true after reviewing the audit volume.'
    if (reason.status === 403) return 'Operator access is required to read the action audit.'
  }
  return 'The action audit is unavailable. Audited actions are refused until it recovers.'
}

function actorLabel(event: FridayAuditEvent) {
  if (event.actor.kind === 'unauthenticated') return 'Unauthenticated (local mode)'
  return event.actor.label || (event.actor.kind === 'service' ? 'Service token' : 'Verified user') + ' · ' + (event.actor.id || '').slice(0, 10)
}

export default function AuditWorkspace() {
  const [events, setEvents] = useState<FridayAuditEvent[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [integrity, setIntegrity] = useState<'verified' | 'broken' | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchFridayAuditEvents(null, controller.signal)
      .then((page) => { setEvents(page.events); setNextBefore(page.nextBefore); setIntegrity(page.integrity) })
      .catch((reason) => { if (reason?.name !== 'AbortError') setError(failureMessage(reason)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  function loadOlder() {
    if (nextBefore === null) return
    setLoadingMore(true)
    fetchFridayAuditEvents(nextBefore)
      .then((page) => {
        setEvents((current) => [...current, ...page.events]); setNextBefore(page.nextBefore)
        if (page.integrity === 'broken') setIntegrity('broken')
      })
      .catch((reason) => setError(failureMessage(reason)))
      .finally(() => setLoadingMore(false))
  }

  return <section className="v3-audit-workspace" aria-label="Action audit workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><ScrollText/></div>
      <div><span className="v3-kicker">DURABLE ACTION AUDIT</span><h2>Audit</h2><p>Append-only, hash-chained record of operator actions. Separate from monitoring history. Read only.</p></div>
    </div>

    {loading ? <p role="status" className="v3-audit-message">Loading action audit…</p>
      : error && !events.length ? <div className="v3-panel v3-audit-empty"><ShieldAlert/><p>{error}</p></div>
        : integrity === 'broken' ? <div className="v3-panel v3-audit-empty broken" role="alert"><ShieldAlert/><h3>Audit log failed integrity verification</h3><p>The hash chain does not verify. Audited actions are refused until an operator investigates the log on the controller.</p></div>
          : <section className="v3-panel" aria-label="Audited actions">
            <div className="v3-section-head"><div><span className="v3-kicker">EVENTS</span><h2>{events.length ? `${events.length} shown` : 'No audited actions yet'}</h2></div><span className="v3-audit-integrity"><ShieldCheck size={14}/>Chain verified</span></div>
            {events.length === 0 ? <p className="v3-audit-message">Registry syncs and diagnostic reruns will appear here once requested.</p>
              : <ol className="v3-audit-list">
                {events.map((event) => <li key={event.seq} className={event.phase}>
                  <span className="v3-audit-seq">#{event.seq}</span>
                  <span className="v3-audit-main"><b>{ACTION_LABELS[event.action] || event.action}</b><small>{event.target ? event.target + ' · ' : ''}{actorLabel(event)}</small></span>
                  <span className={`v3-audit-phase ${event.phase}`}>{PHASE_LABELS[event.phase] || event.phase}</span>
                  {event.detail && <code>{event.detail}</code>}
                  <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
                </li>)}
              </ol>}
            {error && <p role="alert" className="v3-audit-message">{error}</p>}
            {nextBefore !== null && <button type="button" className="v3-audit-more" onClick={loadOlder} disabled={loadingMore}>Load older events</button>}
          </section>}
  </section>
}
