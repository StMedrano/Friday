import { useState } from 'react'
import type { FridayAssistantAttempt, FridayAssistantMode } from '../lib/api'

export type AssistantReplyState = {
  text: string
  mode?: FridayAssistantMode
  provider?: string
  model?: string | null
  fallbackUsed?: boolean
  attempts?: FridayAssistantAttempt[]
  loading: boolean
  error: string | null
}

const provenanceLabels: Record<FridayAssistantMode, string> = {
  'cloud-ai': 'FRIDAY CLOUD AI',
  'local-ai': 'FRIDAY LOCAL AI',
  'local-analysis': 'LOCAL ANALYSIS · NO AI',
}

function metadata(state: AssistantReplyState) {
  const provider = String(state.provider || '').trim()
  const model = String(state.model || '').trim()
  if (provider && model) return `${provider} · ${model}`
  return provider || model
}

export default function AssistantReply({ state, compact = false }: { state: AssistantReplyState; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const meta = metadata(state)
  const label = state.mode ? provenanceLabels[state.mode] : null
  const className = `v3-assistant-reply${compact ? ' compact' : ''}${state.error ? ' error' : ''}${state.loading ? ' loading' : ''}`

  return <div className={className} role="status" aria-live="polite" aria-busy={state.loading ? 'true' : 'false'}>
    {state.loading ? <p className="v3-assistant-text">FRIDAY is analyzing…</p> : <>
      {(label || meta) && <div className="v3-assistant-meta">
        {label && <span className={`v3-assistant-badge ${state.mode}`}>{label}</span>}
        {meta && <small>{meta}</small>}
      </div>}
      <p className="v3-assistant-text">{state.error || state.text}</p>
      {state.fallbackUsed && <div className="v3-assistant-fallback">
        <button
          type="button"
          className="v3-assistant-fallback-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          Fallback used · Details
        </button>
        {expanded && <ul className="v3-assistant-fallback-list">
          {(state.attempts ?? []).map((attempt, index) => <li key={`${attempt.provider}-${attempt.outcome}-${index}`}>
            {attempt.provider} — {attempt.outcome}
          </li>)}
        </ul>}
      </div>}
    </>}
  </div>
}
