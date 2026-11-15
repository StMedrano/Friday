import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import NotConnected from './NotConnected'
import {
  fetchFridayAiDesignerSessions, generateFridayAiDesign,
  type FridayAiDesignerDesign, type FridayAiDesignerSessionsResult,
} from '../lib/api'

const PROMPT_MAX = 4000

const newKey = () => 'wg-' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')

/** Starting text for a lead. It is only a draft: the operator edits and confirms it before anything is sent. */
export const leadPrompt = (businessName: string) =>
  `Website homepage concept for ${businessName}. Clean, modern and mobile friendly, with a clear headline, services, reviews, ` +
  'a contact section and one obvious call to action.'

function failureText(error: string, retryAfter: number | null) {
  switch (error) {
    case 'access-denied': return 'Only an operator can generate designs. Nothing was spent.'
    case 'aidesigner-credits-exhausted': return 'AIDesigner is out of credits. Add credits in AIDesigner, then try again.'
    case 'aidesigner-rate-limited': return `AIDesigner is busy. Try again in ${retryAfter ?? 60} seconds.`
    case 'aidesigner-canvas-busy': return 'That design project is already generating. Wait for it to finish, or pick New design project.'
    case 'aidesigner-session-not-found': return 'That design project no longer exists in AIDesigner. Pick another one.'
    case 'aidesigner-generate-disabled': return 'Generating is switched off on this Friday server.'
    case 'aidesigner-auth-failed': return 'AIDesigner refused Friday’s API key. The owner needs to check AIDESIGNER_API_KEY.'
    case 'invalid-design-request': return 'Friday refused that request. Check the prompt and try again.'
    case 'aidesigner-authentication-required': return 'Sign in through Cloudflare Access to generate designs.'
    default: return 'AIDesigner did not generate a design. Nothing new is linked.'
  }
}

type Run =
  | { state: 'idle' }
  | { state: 'confirm' }
  | { state: 'running' }
  | { state: 'done'; design: FridayAiDesignerDesign }
  | { state: 'failed'; message: string }
  | { state: 'lost' }

/**
 * Website designs for Web Growth, from AIDesigner. Anyone signed in sees recent
 * design projects. When FRIDAY_AIDESIGNER_GENERATE_ENABLED is on, an operator can
 * generate a design, always through an explicit confirm step because each one
 * spends AIDesigner credits. The server enforces operator-only and audits it.
 */
export default function WebGrowthDesigns({ leadName = null }: { leadName?: string | null }) {
  const [result, setResult] = useState<FridayAiDesignerSessionsResult | null>(null)
  const [reload, setReload] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [target, setTarget] = useState('')
  const [run, setRun] = useState<Run>({ state: 'idle' })
  // Reused until the request changes or succeeds, so a retry after a lost answer is a replay, not a second charge.
  const [key, setKey] = useState(newKey)

  useEffect(() => {
    const controller = new AbortController()
    fetchFridayAiDesignerSessions(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setResult({ state: 'unavailable' }) })
    return () => controller.abort()
  }, [reload])

  const edit = useCallback(<T,>(set: (value: T) => void) => (value: T) => {
    set(value); setKey(newKey()); setRun((current) => current.state === 'running' ? current : { state: 'idle' })
  }, [])

  const trimmed = prompt.trim()
  const sessions = result?.state === 'ok' ? result.sessions : []
  const targetTitle = sessions.find((item) => item.sessionId === target)?.title

  const generate = async () => {
    setRun({ state: 'running' })
    const outcome = await generateFridayAiDesign({ prompt: trimmed, viewport, sessionId: target || null, idempotencyKey: key })
    if (outcome.state === 'ok') {
      setRun({ state: 'done', design: outcome.design }); setKey(newKey()); setReload((value) => value + 1)
    } else if (outcome.state === 'lost') setRun({ state: 'lost' })
    else setRun({ state: 'failed', message: failureText(outcome.error, outcome.retryAfter) })
  }

  const running = run.state === 'running'
  return <div className="v3-web-growth-designs" aria-label="Website designs" role="region">
    <div className="v3-agent-detail-head"><div><span className="v3-kicker">AIDESIGNER</span><h4>Website designs</h4></div>
      <button type="button" className="v3-agent-primary" disabled={!result || running} onClick={() => { setResult(null); setReload((value) => value + 1) }}>Refresh designs</button></div>

    {!result ? <p role="status">Loading designs…</p>
      : result.state === 'off' ? <NotConnected title="Website designs" detail="Design projects and the Generate button appear here once FRIDAY_AIDESIGNER_ENABLED and AIDESIGNER_API_KEY are set." setup="AIDesigner design generation"/>
      : result.state === 'signin' ? <p role="status">Sign in through Cloudflare Access (live mode) to see website designs.</p>
      : result.state === 'unavailable' ? <p role="status">Website designs could not be loaded from AIDesigner.</p>
      : <>
        {sessions.length === 0 ? <p>No design projects yet.</p>
          : <ul className="v3-web-growth-design-list" aria-label="Design projects">{sessions.map((session) => <li key={session.sessionId}>
            <span><strong>{session.title}</strong><small>{session.canvasCount} canvas{session.canvasCount === 1 ? '' : 'es'}{session.updatedAt ? ' · Updated ' + new Date(session.updatedAt).toLocaleString() : ''}</small></span>
            {session.editorUrl && <a href={session.editorUrl} target="_blank" rel="noreferrer" aria-label={`Open ${session.title} in AIDesigner`}>Open<ExternalLink size={11} aria-hidden="true"/></a>}
            {session.publishedUrl && <a href={session.publishedUrl} target="_blank" rel="noreferrer" aria-label={`Published page for ${session.title}`}>Published<ExternalLink size={11} aria-hidden="true"/></a>}
          </li>)}</ul>}

        {!result.generate ? <p className="v3-group-tools-note">Generating is off. An operator turns it on with FRIDAY_AIDESIGNER_GENERATE_ENABLED; each design spends AIDesigner credits.</p>
          : <form className="v3-web-growth-design-form" onSubmit={(event) => { event.preventDefault(); if (trimmed && !running) setRun({ state: 'confirm' }) }}>
            <label htmlFor="wg-design-prompt">Describe the website design</label>
            <textarea id="wg-design-prompt" value={prompt} maxLength={PROMPT_MAX} rows={4} disabled={running}
              onChange={(event) => edit(setPrompt)(event.target.value)}
              placeholder="For example: a homepage for a family bakery with online ordering"/>
            {leadName && <button type="button" className="v3-web-growth-design-lead" disabled={running} onClick={() => edit(setPrompt)(leadPrompt(leadName))}>Start from {leadName}</button>}
            <div className="v3-web-growth-design-options">
              <label>Screen <select value={viewport} disabled={running} onChange={(event) => edit(setViewport)(event.target.value === 'mobile' ? 'mobile' : 'desktop')}>
                <option value="desktop">Desktop</option><option value="mobile">Phone</option></select></label>
              <label>Save to <select value={target} disabled={running} onChange={(event) => edit(setTarget)(event.target.value)}>
                <option value="">New design project</option>
                {sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.title}</option>)}</select></label>
            </div>
            {run.state !== 'confirm' && <button type="submit" className="v3-agent-primary" disabled={!trimmed || running}>{running ? 'Generating…' : 'Generate design…'}</button>}
          </form>}

        {run.state === 'confirm' && <div className="v3-web-growth-design-confirm" role="alertdialog" aria-label="Confirm design generation" aria-describedby="wg-design-confirm-text">
          <p id="wg-design-confirm-text"><strong>This spends AIDesigner credits.</strong> One {viewport === 'mobile' ? 'phone' : 'desktop'} design costs at least 1 credit and is saved to {targetTitle ? `“${targetTitle}”` : 'a new design project'}. The prompt below is sent to AIDesigner, and Friday records the request in its audit log.</p>
          <blockquote>{trimmed}</blockquote>
          <div className="v3-web-growth-design-actions">
            <button type="button" className="v3-agent-primary" onClick={() => void generate()} autoFocus>Spend credits and generate</button>
            <button type="button" onClick={() => setRun({ state: 'idle' })}>Cancel</button>
          </div>
        </div>}
        {running && <p role="status">Generating in AIDesigner. This can take a few minutes; keep this page open.</p>}
        {run.state === 'done' && <p role="status">{run.design.replay ? 'AIDesigner returned the design from the earlier request; no new credit was used. ' : 'Design generated. '}
          {run.design.editorUrl ? <a href={run.design.editorUrl} target="_blank" rel="noreferrer">Open it in AIDesigner<ExternalLink size={11} aria-hidden="true"/></a> : 'It is in the design project list above.'}</p>}
        {run.state === 'failed' && <p role="status">{run.message}</p>}
        {run.state === 'lost' && <p role="status">Friday lost the answer, so the design may still be generating. Generate again with the same prompt and AIDesigner should return that design instead of charging twice; check the list first.</p>}
      </>}
    <p className="v3-group-tools-note">Operators only, audited. Only links come back to Friday, never the generated page.</p>
  </div>
}
