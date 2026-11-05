import { useCallback, useEffect, useState } from 'react'
import NotConnected from './NotConnected'
import {
  decideFridayApproval, fetchFridayApprovals, FridayApprovalError,
  type FridayApprovalItem, type FridayApprovalsResult,
} from '../lib/api'

const REFRESH_MS = 60_000
const SEVERITY: Record<string, string> = { high: 'critical', warning: 'warning', info: '' }
const ERRORS: Record<string, string> = {
  'approval-already-decided': 'Someone already decided this proposal.',
  'approval-not-found': 'This incident is no longer open.',
  'audit-unavailable': 'The action audit could not record this decision, so it was not saved.',
}

function when(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function decisionError(reason: unknown) {
  if (reason instanceof FridayApprovalError) {
    if (reason.status === 403) return 'Operator access is required to approve or deny.'
    return ERRORS[reason.code] || 'The decision could not be saved.'
  }
  return 'The decision could not be saved.'
}

/**
 * Approvals queue: each open incident with a recommended action waits here for an
 * operator to approve or deny. Decisions are recorded and audited; nothing runs.
 * `compact` shows the first few pending items for the Agents action center.
 */
export default function ApprovalsQueue({ compact = false }: { compact?: boolean }) {
  const [result, setResult] = useState<FridayApprovalsResult | null>(null)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback((signal?: AbortSignal) => fetchFridayApprovals(signal)
    .then((next) => { if (!signal?.aborted) setResult(next) })
    .catch(() => { if (!signal?.aborted) setResult({ state: 'unavailable' }) }), [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = setInterval(() => { void load(controller.signal) }, REFRESH_MS)
    return () => { controller.abort(); clearInterval(timer) }
  }, [load])

  const decide = async (item: FridayApprovalItem, decision: 'approve' | 'deny') => {
    setBusy(item.incidentId)
    setMessage('')
    try {
      await decideFridayApproval(item.incidentId, decision)
      setMessage(`${item.serviceName || item.title} ${decision === 'approve' ? 'approved' : 'denied'}. Nothing was executed.`)
    } catch (reason) {
      setMessage(decisionError(reason))
    } finally {
      setBusy('')
      await load()
    }
  }

  if (!result || result.state === 'disabled') {
    return <NotConnected title="Approvals" detail="Remediation proposals from open incidents queue here once the approvals queue (FRIDAY_APPROVALS_ENABLED) is on."/>
  }
  if (result.state === 'unavailable') return <p className="fx-activity-note" role="status">Approvals could not be loaded.</p>

  const { pending, recent } = result.approvals
  const shown = compact ? pending.slice(0, 3) : pending
  return <section className={`fx-approvals${compact ? ' compact' : ''}`} aria-label="Approvals">
    <h3>Approvals <span className="fx-approvals-count">{pending.length} pending</span></h3>
    {message && <p className="fx-activity-note" role="status">{message}</p>}
    {pending.length === 0 ? <p className="fx-activity-note">Nothing is waiting for approval.</p>
      : <ul aria-label="Pending approvals">{shown.map((item) => <li key={item.id}>
        <span className="fx-agent-activity-head">
          <b>{item.title}{item.serviceName ? ` · ${item.serviceName}` : ''}</b>
          {item.severity && <span className={`fx-status ${SEVERITY[item.severity] ?? ''}`}>{item.severity}</span>}
        </span>
        {item.detail && <small>{item.detail}</small>}
        {!compact && item.recommendedAction && <small>Proposed: {item.recommendedAction}</small>}
        <small>{item.openedAt ? `Opened ${when(item.openedAt)}` : ''}</small>
        <span className="fx-approvals-actions">
          <button type="button" disabled={Boolean(busy)} onClick={() => void decide(item, 'approve')} aria-label={`Approve ${item.title}${item.serviceName ? ` for ${item.serviceName}` : ''}`}>Approve</button>
          <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void decide(item, 'deny')} aria-label={`Deny ${item.title}${item.serviceName ? ` for ${item.serviceName}` : ''}`}>Deny</button>
        </span>
      </li>)}</ul>}
    {compact && pending.length > shown.length && <p className="fx-activity-note">{pending.length - shown.length} more on the Approvals page.</p>}
    {!compact && <>
      <h3>Recent decisions</h3>
      {recent.length === 0 ? <p className="fx-activity-note">No decisions yet.</p>
        : <ul aria-label="Recent decisions">{recent.map((item) => <li key={item.id}>
          <span className="fx-agent-activity-head">
            <b>{item.title}{item.serviceName ? ` · ${item.serviceName}` : ''}</b>
            <span className={`fx-status ${item.state === 'approved' ? '' : 'warning'}`}>{item.state}</span>
          </span>
          <small>{when(item.decidedAt)}{item.decidedBy ? ` · ${item.decidedBy}` : ''} · incident {item.incidentStatus === 'open' ? 'still open' : 'resolved'}</small>
        </li>)}</ul>}
    </>}
    <p className="fx-activity-note">Approval is recorded and audited only. Automated fixes are not connected, so nothing runs.</p>
  </section>
}
