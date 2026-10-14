import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronRight, Search } from 'lucide-react'
import AgentsWorkspaceHeader from './AgentsWorkspaceHeader'
import GroupAdvisory from './GroupAdvisory'
import HomeLabSnapshot from './HomeLabSnapshot'
import {
  askFridayAgent,
  fetchFridayAgentGroups,
  type GroupWorkspace,
  fetchFridayAgentRegistryStatus,
  fetchFridayAgents,
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
  const [prompt, setPrompt] = useState('')
  const [asking, setAsking] = useState(false)
  const [answer, setAnswer] = useState<FridayAgentResponse | null>(null)
  const [answerError, setAnswerError] = useState<string | null>(null)

  const [workspace, setWorkspace] = useState<GroupWorkspace | null>(null)
  const [groupsUnavailable, setGroupsUnavailable] = useState(false)
  const [view, setView] = useState('all')
  const [memberId, setMemberId] = useState('')
  const [roleQuery, setRoleQuery] = useState('')
  const askController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([fetchFridayAgents(controller.signal), fetchFridayAgentRegistryStatus(controller.signal)])
      .then(([nextAgents, nextStatus]) => {
        if (controller.signal.aborted) return
        setAgents(nextAgents)
        setStatus(nextStatus)
        setSelectedId(nextAgents.find(item => item.enabled)?.id || nextAgents[0]?.id || '')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setAgents([]); setStatus(null); setUnavailable(true)
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    fetchFridayAgentGroups(controller.signal)
      .then(value => { if (!controller.signal.aborted) setWorkspace(value) })
      .catch(() => { if (!controller.signal.aborted) setGroupsUnavailable(true) })
    return () => { controller.abort(); askController.current?.abort() }
  }, [])

  const group = workspace?.groups.find(item => item.id === view)
  const member = group?.members.find(item => item.id === memberId)
  const selected = useMemo(() => {
    const id = view === 'all' ? selectedId
      : member?.implementation === 'existing' && member.state !== 'unavailable' ? member.agentId : null
    const candidate = agents.find(agent => agent.id === id) || null
    if (view === 'all' && candidate && !(candidate.name + ' ' + candidate.id).toLowerCase().includes(roleQuery.trim().toLowerCase())) return null
    return candidate
  }, [agents, selectedId, view, member, roleQuery])
  const matchesQuery = (name: string, id: string) => (name + ' ' + id).toLowerCase().includes(roleQuery.trim().toLowerCase())
  const visibleMembers = group?.members.filter(item => matchesQuery(item.name, item.id)) || []
  const visibleAgents = agents.filter(item => matchesQuery(item.name, item.id))
  const visibleCount = group ? visibleMembers.length : visibleAgents.length
  const canAsk = !!selected?.enabled && (view === 'all' || member?.state === 'configured')

  function clearReply() {
    askController.current?.abort()
    askController.current = null
    setAsking(false); setPrompt(''); setAnswer(null); setAnswerError(null)
  }

  async function askSelected(event: React.FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!selected || !canAsk || !text || asking) return
    const controller = new AbortController()
    askController.current = controller
    setAsking(true); setAnswer(null); setAnswerError(null)
    try {
      const reply = await askFridayAgent(selected.id, text, controller.signal)
      if (!controller.signal.aborted) setAnswer(reply)
    } catch (error) {
      if (!controller.signal.aborted) setAnswerError(error instanceof Error ? error.message : 'Local agent inference unavailable')
    } finally {
      if (!controller.signal.aborted) { setAsking(false); askController.current = null }
    }
  }

  return <section className="v3-agents-workspace" aria-label="Friday agents workspace">
    <AgentsWorkspaceHeader workspace={workspace} status={status} loading={loading} unavailable={unavailable}
      groupsUnavailable={groupsUnavailable} view={view} onViewChange={next => {
        clearReply(); setView(next); setMemberId(''); setRoleQuery('')
      }} />

    <div className="v3-agent-toolbar">
      <div><h3>{group?.name || 'Registered agents'}</h3><p>{group ? 'Inspect a role and its declared availability.' : 'Git-backed definitions with advisory access.'}</p></div>
      <div className="v3-agent-search">
        <label htmlFor="v3-agent-role-search">Find a role</label>
        <div><Search size={16} aria-hidden="true" /><input id="v3-agent-role-search" type="search"
          placeholder="Search roles…" value={roleQuery} maxLength={100} onChange={event => {
            const value = event.target.value
            setRoleQuery(value)
            const current = view === 'all' ? selected : member
            if (current && !(current.name + ' ' + current.id).toLowerCase().includes(value.trim().toLowerCase())) {
              clearReply()
              if (view === 'all') setSelectedId('')
              else setMemberId('')
            }
          }} /></div>
      </div>
    </div>
    <div className="v3-agent-work-notice"><span>Work integration not connected</span><small>Tasks and shared memory are not available in this workspace yet.</small></div>
    {roleQuery.trim() && visibleCount === 0 ? <div className="v3-agent-empty" role="status">
      <Search size={24} aria-hidden="true" /><h3>No matching roles</h3><p>Try another role name or clear your search.</p>
      <button type="button" className="v3-agent-primary" onClick={() => setRoleQuery('')}>Clear search</button>
    </div> : null}
    {workspace?.registryStatus === 'unavailable' && !unavailable ? <div className="v3-agent-authority" role="status">Group registry unavailable. Linked members are unavailable.</div> : null}
    {group ? <div className={'v3-group-tools ' + (group.id === 'homelab' ? 'with-evidence' : '')}>
      <GroupAdvisory key={group.id} groupId={group.id} groupName={group.name}/>
      {group.id === 'homelab' ? <HomeLabSnapshot/> : null}
    </div> : null}
    {group && visibleMembers.length > 0 ? <div className="v3-agent-layout">
      <aside className="v3-agent-list" aria-label={group.name + ' members'}>
        {visibleMembers.map(item => <button type="button" key={item.id}
          className={'v3-agent-card ' + (memberId === item.id ? 'selected' : '')} aria-pressed={memberId === item.id}
          onClick={() => { clearReply(); setMemberId(item.id) }}>
          <span className={"v3-agent-dot " + item.state} aria-hidden="true" />
          <span><strong>{item.name}</strong><small>{item.reason}</small></span>
          <em className={'v3-agent-state ' + item.state}>{item.state === 'catalogued' ? 'Planned' : item.state === 'configured' ? 'Configured' : item.state === 'disabled' ? 'Disabled' : 'Unavailable'}</em>
        </button>)}
      </aside>
      {member ? <article className="v3-agent-detail" aria-label="Group member detail">
        <span className="v3-kicker">GROUP MEMBER</span><h3>{member.name}</h3>
        <p>{member.reason}</p>
        <p>{member.agentId ? 'Registry binding: ' + member.agentId : 'Planned role · No registered binding'}</p>
        {!selected ? <button type="button" className="v3-agent-primary" disabled>Ask this agent</button> : null}
      </article> : <div className="v3-agent-detail v3-agent-selection-empty"><Bot size={28} aria-hidden="true" /><h3>Select a role</h3><p>Inspect its availability, scope, and registry binding.</p><span><ChevronRight size={14} aria-hidden="true" />Choose a member from the list</span></div>}
    </div> : null}

    {unavailable && !agents.length ? <div className="v3-agent-empty" role="status">
      <h3>Agent registry unavailable</h3>
      <p>Friday will not invent agent records. Overview, incidents, and the general FRIDAY assistant remain separate.</p>
    </div> : null}

    {!unavailable && !loading && agents.length === 0 ? <div className="v3-agent-empty" role="status">
      <h3>No registered agents</h3>
      <p>Approved Git definitions synchronize from the server; contact an operator if registry setup is pending.</p>
    </div> : null}

    {(view === 'all' ? visibleAgents.length > 0 : !!selected) ? <div className={view === 'all' ? 'v3-agent-layout' : 'v3-agent-bound-detail'}>
      {view === 'all' ? <aside className="v3-agent-list" aria-label="Registered agents">
        {visibleAgents.map((agent) => <button
          type="button"
          key={agent.id}
          className={`v3-agent-card ${selectedId === agent.id ? 'selected' : ''}`}
          onClick={() => { clearReply(); setSelectedId(agent.id) }}
          aria-pressed={selectedId === agent.id}
        >
          <span className={`v3-agent-dot ${agent.enabled ? 'configured' : 'disabled'}`} aria-hidden="true" />
          <span><strong>{agent.name}</strong><small>{agent.description || agent.id}</small></span>
          <em className={'v3-agent-state ' + (agent.enabled ? 'configured' : 'disabled')}>{agent.enabled ? 'Configured' : 'Disabled'}</em>
        </button>)}
      </aside> : null}

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
            disabled={!canAsk || asking}
          />
          <div className="v3-agent-ask-foot">
            <small>Manual selection bypasses automatic routing · CT108 only</small>
            <button type="submit" className="v3-agent-primary" disabled={!canAsk || asking || !prompt.trim()}>
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
    <footer className="v3-agent-authority"><strong>Git is authoritative.</strong> Registry refresh runs during trusted server startup or through an authenticated operator-only API. The browser cannot initiate a sync.</footer>
  </section>
}
