import { useEffect, useMemo, useState } from 'react'
import { Bot, Cpu, ShieldCheck, Wrench } from 'lucide-react'
import { fetchFridayAgents, type FridayAgentSummary } from '../lib/api'

export default function AgentsWorkspace() {
  const [agents, setAgents] = useState<FridayAgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetchFridayAgents(controller.signal)
      .then(setAgents)
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') setError('Agent inventory unavailable')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const toolCount = useMemo(() => agents.reduce((total, agent) => total + agent.tools.length, 0), [agents])
  const approvalCount = useMemo(() => agents.reduce((total, agent) => total + Object.values(agent.permissions).filter((value) => value === 'approval').length, 0), [agents])

  return <section className="v3-detail">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><Bot/></div>
      <div><span className="v3-kicker">FRIDAY CONTROL PLANE</span><h2>Agents</h2><p>Local agent definitions, tools, and policy boundaries currently available to FRIDAY.</p></div>
    </div>
    <div className="v3-detail-grid">
      <article><Bot/><strong>{agents.length}</strong><span>Registered agents</span></article>
      <article><Wrench/><strong>{toolCount}</strong><span>Declared tools</span></article>
      <article><ShieldCheck/><strong>{approvalCount}</strong><span>Approval-gated permissions</span></article>
    </div>
    <div className="v3-panel v3-list">
      <div className="v3-section-head"><div><span className="v3-kicker">AGENT REGISTRY</span><h2>Local agents</h2></div></div>
      {loading && <div className="v3-list-row"><span><b>Loading agents…</b><small>Reading Friday's local registry</small></span></div>}
      {error && <div className="v3-list-row"><span><b>{error}</b><small>Friday remains safe; no agent actions were attempted.</small></span></div>}
      {!loading && !error && agents.length === 0 && <div className="v3-list-row"><span><b>No agents registered</b><small>Add enabled JSON definitions to the configured local agent directory.</small></span></div>}
      {agents.map((agent) => <article className="v3-agent-card" key={agent.id}>
        <div className="v3-agent-card-head">
          <div className="v3-node-icon"><Bot/></div>
          <div><span className="v3-kicker">{agent.id}</span><h3>{agent.name}</h3><p>{agent.description}</p></div>
          <div className="v3-status online"><i/>READY</div>
        </div>
        <div className="v3-agent-meta"><span><Cpu size={14}/>{agent.model.provider} · {agent.model.model || 'default'}</span></div>
        <div className="v3-agent-groups">
          <div><b>Tools</b><div className="v3-agent-badges">{agent.tools.map((tool) => <span key={tool}>{tool}</span>)}</div></div>
          <div><b>Permissions</b><div className="v3-agent-badges">{Object.entries(agent.permissions).map(([permission, mode]) => <span key={permission} data-mode={mode}>{permission} · {mode}</span>)}</div></div>
        </div>
      </article>)}
    </div>
  </section>
}
