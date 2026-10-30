import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { fetchFridayAgentGroups, type FridayAgentGroups, type FridayGroupMemberState } from '../lib/api'

const STATE_LABELS: Record<FridayGroupMemberState, string> = {
  configured: 'Configured',
  disabled: 'Disabled',
  unavailable: 'Unavailable',
  catalogued: 'Planned',
}

export default function AgentGroupsPanel() {
  const [groups, setGroups] = useState<FridayAgentGroups | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchFridayAgentGroups(controller.signal)
      .then(setGroups)
      .catch((reason) => { if (reason?.name !== 'AbortError') setError(true) })
    return () => controller.abort()
  }, [])

  if (error) return <section className="v3-panel" aria-label="Agent groups"><p role="status" className="v3-settings-message">Agent groups are unavailable.</p></section>
  if (!groups) return <section className="v3-panel" aria-label="Agent groups"><p role="status" className="v3-settings-message">Loading agent groups…</p></section>

  const configured = groups.groups.flatMap((group) => group.members).filter((member) => member.state === 'configured').length
  return <section className="v3-panel" aria-label="Agent groups">
    <div className="v3-section-head">
      <div><span className="v3-kicker">GROUPS</span><h2>{configured} configured of {groups.groups.flatMap((group) => group.members).length} roles</h2></div>
      <Users size={16} aria-hidden="true"/>
    </div>
    {groups.registryStatus === 'unavailable' && <p role="status" className="v3-settings-message">The agent registry is unavailable, so member readiness cannot be confirmed.</p>}
    {groups.groups.map((group) => <div key={group.id}>
      <h3>{group.name}</h3>
      <ul className="v3-settings-list compact" aria-label={`${group.name} roles`}>
        {group.members.map((member) => <li key={member.id}>
          <span className="v3-settings-name"><b>{member.name}</b><small>{member.reason}</small></span>
          <span className={`v3-settings-pill ${member.state === 'configured' ? 'on' : member.state === 'catalogued' ? 'off' : 'warn'}`}>{STATE_LABELS[member.state]}</span>
        </li>)}
      </ul>
    </div>)}
    <p className="v3-settings-message">Read only. Friday runs no group workers and performs no group actions.</p>
  </section>
}
