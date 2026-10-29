import { AppWindow, Briefcase, Layers, LoaderCircle, Server, ShieldCheck } from 'lucide-react'
import type { FridayAgentRegistryStatus, GroupWorkspace } from '../lib/api'

const groupPresentation = {
  techtactics: { Icon: Briefcase, description: 'Web Growth & client services' },
  'app-builder': { Icon: AppWindow, description: 'Plan, build & review' },
  homelab: { Icon: Server, description: 'Infrastructure & service health' },
}

type Props = {
  workspace: GroupWorkspace | null
  status: FridayAgentRegistryStatus | null
  loading: boolean
  unavailable: boolean
  groupsUnavailable: boolean
  view: string
  onViewChange: (view: string) => void
}

export default function AgentsWorkspaceHeader({ workspace, status, loading, unavailable, groupsUnavailable, view, onViewChange }: Props) {
  const members = workspace?.groups.flatMap(group => group.members)
  const configured = new Set(members?.filter(member => member.state === 'configured' && member.agentId).map(member => member.agentId)).size
  const registryLabel = unavailable ? 'Unavailable' : loading ? 'Loading' : status?.status === 'ok' ? 'Registry connected' : status?.status || 'Unknown'

  return <>
    <header className="v3-agents-hero">
      <div>
        <span className="v3-kicker">LOCAL AGENT REGISTRY</span>
        <h2>Friday Agents</h2>
        <p>One workspace for your business, builds, and infrastructure.</p>
      </div>
      <span className={'v3-agent-registry-state ' + (status?.status === 'ok' ? 'online' : '')}>
        <span className="v3-agent-dot" aria-hidden="true" />
        {registryLabel}
      </span>
    </header>

    {workspace ? <section className="v3-agent-summary" aria-label="Workspace summary">
      <dl>
        <div><dt>Workspace groups</dt><dd>{workspace.groups.length}</dd></div>
        <div><dt>Declared roles</dt><dd>{members?.length}</dd></div>
        <div><dt>Configured members</dt><dd>{workspace.registryStatus === 'unavailable' ? 'Unavailable' : configured}</dd></div>
      </dl>
      <p><ShieldCheck size={16} aria-hidden="true" /><span>Advisory only · No actions executed<br /><small>Configured does not mean running.</small></span></p>
    </section> : <div className="v3-agent-notice" role="status">
      {groupsUnavailable ? <span>Group workspace unavailable</span> : <><LoaderCircle className="v3-agent-loading-icon" size={16} aria-hidden="true" />Loading group workspace…</>}
      <small>Advisory only · No actions executed</small>
      <small>Configured does not mean running.</small>
    </div>}

    <nav className="v3-agent-group-controls" aria-label="Agent groups">
      {workspace?.groups.map(group => {
        const presentation = groupPresentation[group.id as keyof typeof groupPresentation]
        const Icon = presentation?.Icon || Layers
        return <button type="button" key={group.id}
          aria-label={group.name + ' · ' + group.members.length + ' roles'}
          aria-pressed={view === group.id}
          className="v3-agent-group-button"
          onClick={() => onViewChange(group.id)}>
          <span className="v3-agent-group-icon"><Icon size={20} aria-hidden="true" /></span>
          <span><strong>{group.name}</strong><small>{presentation?.description || 'Declared roles'}</small></span>
          <span className="v3-agent-role-count" aria-hidden="true">{group.members.length}</span>
        </button>
      })}
      <button type="button" className="v3-agent-group-button v3-agent-all-button"
        aria-pressed={view === 'all'} onClick={() => onViewChange('all')}>
        <Layers size={16} aria-hidden="true" /><span>All registered agents</span>
      </button>
    </nav>
  </>
}
