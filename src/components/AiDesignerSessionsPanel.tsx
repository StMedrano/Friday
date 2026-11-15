import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import NotConnected from './NotConnected'
import { fetchFridayAiDesignerSessions, type FridayAiDesignerSessionsResult } from '../lib/api'

function updated(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : `Updated ${date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

/**
 * Read-only list of recent AIDesigner design sessions from GET /api/aidesigner/sessions.
 * It never generates a design: that spends AIDesigner credits and is not offered here.
 * `enabled` is the AIDesigner integration state from Settings; when it is off no request is sent.
 */
export default function AiDesignerSessionsPanel({ enabled, hidden = false }: { enabled: boolean; hidden?: boolean }) {
  const [result, setResult] = useState<FridayAiDesignerSessionsResult | null>(null)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetchFridayAiDesignerSessions(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setResult({ state: 'unavailable' }) })
    return () => controller.abort()
  }, [enabled])

  return <section className="v3-panel v3-settings-wide" aria-label="Design sessions" hidden={hidden}>
    <div className="v3-section-head"><div><span className="v3-kicker">AIDESIGNER</span><h2>Design sessions</h2></div></div>
    {!enabled ? <NotConnected title="Design sessions" detail="AIDesigner sessions are listed here once FRIDAY_AIDESIGNER_ENABLED and AIDESIGNER_API_KEY are set." setup="AIDesigner design generation"/>
      : !result ? <p role="status" className="v3-settings-message">Loading design sessions…</p>
      : result.state === 'signin' ? <p role="status" className="v3-settings-message">Sign in through Cloudflare Access (live mode) to list design sessions.</p>
      : result.state === 'unavailable' ? <p role="status" className="v3-settings-message">Design sessions could not be loaded.</p>
      : result.sessions.length === 0 ? <p className="v3-settings-message">No design sessions yet.</p>
      : <ul className="v3-settings-list">
        {result.sessions.map((session) => <li key={session.sessionId}>
          <span className="v3-settings-name"><b>{session.title}</b>
            <small>{[updated(session.updatedAt), `${session.canvasCount} canvas${session.canvasCount === 1 ? '' : 'es'}`].filter(Boolean).join(' · ')}</small>
          </span>
          {session.editorUrl && <a href={session.editorUrl} target="_blank" rel="noreferrer" aria-label={`Open ${session.title} in AIDesigner`}>Open<ExternalLink size={11} aria-hidden="true"/></a>}
          {session.publishedUrl && <a href={session.publishedUrl} target="_blank" rel="noreferrer" aria-label={`Published page for ${session.title}`}>Published<ExternalLink size={11} aria-hidden="true"/></a>}
        </li>)}
      </ul>}
    {enabled && <p className="v3-settings-message">Read only. Generating a design spends AIDesigner credits and is not available from Friday.</p>}
  </section>
}
