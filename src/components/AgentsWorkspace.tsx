import { useEffect, useMemo, useState } from 'react'
import {
  askFridayAgent,
  fetchFridayAgentRegistryStatus,
  fetchFridayAgents,
  syncFridayAgentRegistry,
  type FridayAgent,
  type FridayAgentRegistryStatus,
  type FridayAgentResponse,
} from '../lib/api'

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${flatten(item)}`).join(' · ')
  return value == null ? '' : String(value)
}

function displayDate(value?: string | null) {
  if (!value) return 'Not synced yet'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AgentsWorkspace() {
  const [agents, setAgents] = useState<FridayAgent[]>([])
  const [status, setStatus] = useState<FridayAgentRegistryStatus | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<FridayAgentResponse | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)

  async function load(signal?: AbortSignal) {
    const [nextAgents, nextStatus] = await Promise.all([
      fetchFridayAgents(signal),
      fetchFridayAgentRegistryStatus(signal),
    ])
    setAgents(nextAgents)
    setStatus(nextStatus)
    setSelectedId((current) => current && nextAgents.some((item) => item.id === current)
      ? current
      : nextAgents.find((item) => item.enabled)?.id || nextAgents[0]?.id || '')
    setUnavailable(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .catch(() => { setAgents([]); setStatus(null); setUnavailable(true) })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const selected = useMemo(() => agents.find((agent) => agent.id === selectedId) || null, [agents, selectedId])

  async function syncRegistry() {
    if (syncing) return
    setSyncing(true)
    try {
      await syncFridayAgentRegistry()
      await load()
    } catch {
      setUnavailable(true)
    } finally {
      setSyncing(false)
    }
  }

  async function askSelected(event: React.FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!selected || !selected.enabled || !text || asking) return
    setAsking(true)
    setAnswer(null)
    setAnswerError(null)
    try {
      setAnswer(await askFridayAgent(selected.id, text))
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : 'Local agent inference unavailable')
    } finally {
      setAsking(false)
    }
  }

  return <section className="v3-agents-workspace" aria-label="Friday agents workspace">
    <header className="v3-agents-hero">
      <div>
        <span className="v3-kicker">LOCAL AGENT REGISTRY</span>
        <h2>Friday Agents</h2>
        <p>Git-backed specialist agents running through local Ollama. Advisory only · No actions executed</p>
      </div>
      <div className="v3-agent-registry-actions">
        <span className={`v3-agent-registry-state ${status?.status === 'ok' ? 'online' : ''}`}>
          {unavailable ? 'Unavailable' : loading ? 'Loading' : status?.status || 'Unknown'}
        </span>
        <button type="button" className="v3-agent-primary" onClick={syncRegistry} disabled={syncing || loading}>
          {syncing ? 'Syncing…' : 'Sync registry'}
        </button>
      </div>
    </header>

    <div className="v3-agent-authority">
      <strong>Git is authoritative.</strong> Sync copies validated definitions into Friday-owned registry state only; it cannot edit policy or managed infrastructure.
    </div>

    {unavailable && !agents.length ? <div className="v3-agent-empty" role="status">
      <h3>Agent registry unavailable</h3>
      <p>Friday will not invent agent records. Overview, incidents, and the general FRIDAY assistant remain separate.</p>
    </div> : null}

    {!unavailable && !loading && agents.length === 0 ? <div className="v3-agent-empty" role="status">
      <h3>No registered agents</h3>
      <p>Synchronize approved Git definitions after the local registry is configured.</p>
    </div> : null}

    {agents.length > 0 ? <div className="v3-agent-layout">
      <aside className="v3-agent-list" aria-label="Registered agents">
        {agents.map((agent) => <button
          type="button"
          key={agent.id}
          className={`v3-agent-card ${selectedId === agent.id ? 'selected' : ''}`}
          onClick={() => { setSelectedId(agent.id); setAnswer(null); setAnswerError(null) }}
        >
          <span className={`v3-agent-dot ${agent.enabled ? 'online' : ''}`} />
          <span><strong>{agent.name}</strong><small>{agent.description || agent.id}</small></span>
          <em>{agent.enabled ? 'Enabled' : 'Disabled'}</em>
        </button>)}
      </aside>

      {selected ? <article className="v3-agent-detail">
        <div className="v3-agent-detail-head">
          <div>
            <span className="v3-kicker">AGENT POLICY</span>
            <h3>{selected.id}</h3>
          </div>
          <span className="v3-agent-local-badge">Local Ollama</span>
        </div>

        <div className="v3-agent-metadata">
          <article><span>Model profile</span><strong>{selected.model.profile}</strong></article>
          <article><span>Runtime</span><strong>CT108 · Ollama</strong></article>
          <article><span>Scope</span><strong>{flatten(selected.scope) || 'Declared in Git'}</strong></article>
          <article><span>Tools</span><strong>{selected.tools.join(', ') || 'None declared'}</strong></article>
          <article><span>Permissions</span><strong>{flatten(selected.permissions) || 'Undeclared actions forbidden'}</strong></article>
          <article><span>Source</span><strong>{selected.source.path || 'Git definition'}</strong></article>
          <article><span>Checksum</span><strong>{selected.source.checksum || 'Unavailable'}</strong></article>
          <article><span>Last sync</span><strong>{displayDate(selected.source.syncedAt || status?.lastSyncAt)}</strong></article>
        </div>

        <form className="v3-agent-ask" onSubmit={askSelected}>
          <label htmlFor="v3-agent-prompt">Ask selected agent</label>
          <textarea
            id="v3-agent-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask a read-only question about this agent's scope…"
            maxLength={4000}
            disabled={!selected.enabled || asking}
          />
          <div className="v3-agent-ask-foot">
            <small>Manual selection bypasses automatic routing · CT108 only</small>
            <button type="submit" className="v3-agent-primary" disabled={!selected.enabled || asking || !prompt.trim()}>
              {asking ? 'Asking…' : 'Ask this agent'}
            </button>
          </div>
        </form>

        {(answer || answerError) ? <div className={`v3-agent-answer ${answerError ? 'error' : ''}`} role="status">
          <div className="v3-agent-answer-meta">
            <strong>{answer?.provider || 'local-agent'}{answer?.model ? ` · ${answer.model}` : ''}</strong>
            <span>{answer?.modelProfile || selected.model.profile}</span>
          </div>
          <p>{answerError || answer?.text || answer?.reason}</p>
          <small>Advisory only · No actions executed{answer?.execution?.performed === false ? ' · execution.performed=false' : ''}</small>
        </div> : null}
      </article> : null}
    </div> : null}
  </section>
}
