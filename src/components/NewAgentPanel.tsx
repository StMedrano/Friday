import NotConnected from './NotConnected'
import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  fetchFridayAgentProposalSetup, FridayAgentProposalError, proposeFridayAgent,
  type FridayAgentProposal, type FridayAgentProposalSetup,
} from '../lib/api'

type Mode = 'auto' | 'approval' | 'forbidden'
const AUTO_ALLOWED = /^(inspect|read_|list_|get_|view_|check_)/
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean)
const words = (value: string) => value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)

/** "action: mode" per line, e.g. "inspect: auto" or "restart_vm: approval". */
export function parsePermissions(value: string): Record<string, Mode> | null {
  const result: Record<string, Mode> = {}
  for (const line of lines(value)) {
    const match = line.match(/^([a-z][a-z0-9_]{1,47})\s*:\s*(auto|approval|forbidden)$/)
    if (!match || Object.hasOwn(result, match[1])) return null
    if (match[2] === 'auto' && !AUTO_ALLOWED.test(match[1])) return null
    result[match[1]] = match[2] as Mode
  }
  return result
}

function failure(reason: unknown) {
  if (reason instanceof FridayAgentProposalError) {
    if (reason.code === 'invalid-agent-proposal') return `Check the ${reason.field || 'form'}: ${hint(reason.field)}`
    if (reason.code === 'agent-exists') return 'An agent with this id is already in Git. Choose another id.'
    if (reason.status === 403) return 'Only a signed-in operator can propose agents.'
    if (reason.code === 'github-denied') return 'GitHub refused the Friday token. The owner needs to check its permissions.'
    if (reason.code === 'github-rejected') return 'GitHub rejected the pull request (the branch may already exist). Try again.'
    if (reason.code === 'audit-unavailable') return 'The action audit could not record this, so nothing was proposed.'
  }
  return 'The pull request could not be opened. Try again.'
}

function hint(field: string) {
  switch (field) {
    case 'id': return 'lowercase letters, numbers and dashes, 3 to 64 characters.'
    case 'permissions': return 'one "action: mode" per line; only inspect, read_, list_, get_, view_ or check_ actions may be auto.'
    case 'profile': return 'pick one of the listed local model profiles.'
    case 'tools': return 'lowercase tool names with underscores, up to 20.'
    case 'instructions': return 'up to 20 lines of 300 characters, with no secrets.'
    default: return 'every field is required and must not contain secrets.'
  }
}

/** New agent: opens a pull request adding agents/<id>.json; the owner merges and syncs. */
export default function NewAgentPanel() {
  const [setup, setSetup] = useState<FridayAgentProposalSetup | null>(null)
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [profile, setProfile] = useState('')
  const [hosts, setHosts] = useState('')
  const [tools, setTools] = useState('')
  const [permissions, setPermissions] = useState('inspect: auto')
  const [instructions, setInstructions] = useState('Inspect before proposing a repair.')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [proposal, setProposal] = useState<FridayAgentProposal | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchFridayAgentProposalSetup(controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setSetup(result); if (result.state === 'ok') setProfile(result.profiles[0] || '') } })
      .catch(() => { if (!controller.signal.aborted) setSetup({ state: 'unavailable' }) })
    return () => controller.abort()
  }, [])

  if (!setup) return null
  if (setup.state === 'disabled')
    return <NotConnected title="New agents" detail="Agents are defined in Git. Proposing one from Friday needs FRIDAY_AGENT_PROPOSALS_ENABLED and a GitHub token on the server." setup="New agents from Friday"/>
  if (setup.state === 'unavailable') return <p className="v3-settings-message" role="status">New agents could not be loaded.</p>

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const parsed = parsePermissions(permissions)
    if (!parsed) { setNotice(`Check the permissions: ${hint('permissions')}`); return }
    setSaving(true)
    setNotice('')
    try {
      const result = await proposeFridayAgent({
        id: id.trim(), name: name.trim(), description: description.trim(), profile,
        hosts: words(hosts), tools: words(tools), permissions: parsed, instructions: lines(instructions), enabled: true,
      })
      setProposal(result)
      setOpen(false)
    } catch (reason) {
      setNotice(failure(reason))
    } finally {
      setSaving(false)
    }
  }

  return <section className="fx-new-agent" aria-label="New agent">
    <h3>New agent</h3>
    <p>Friday opens a pull request on {setup.repository} that adds the agent's definition. Nothing runs until the owner merges it and syncs the registry.</p>
    {proposal && <p role="status" className="v3-settings-message">Pull request #{proposal.number} opened for <code>{proposal.path}</code>.{' '}
      <a href={proposal.url} target="_blank" rel="noopener noreferrer">Review it on GitHub<ExternalLink size={11} aria-hidden="true"/></a></p>}
    {!open
      ? <button type="button" onClick={() => { setOpen(true); setProposal(null); setNotice('') }}>Propose an agent</button>
      : <form className="v3-settings-form" aria-label="Propose an agent" onSubmit={(event) => void submit(event)}>
        <label htmlFor="fx-agent-id">Id<input id="fx-agent-id" value={id} required maxLength={64} placeholder="dns-watcher" onChange={(event) => setId(event.target.value)}/></label>
        <label htmlFor="fx-agent-name">Name<input id="fx-agent-name" value={name} required maxLength={80} onChange={(event) => setName(event.target.value)}/></label>
        <label htmlFor="fx-agent-description">Purpose<input id="fx-agent-description" value={description} required maxLength={500} onChange={(event) => setDescription(event.target.value)}/></label>
        <label htmlFor="fx-agent-profile">Model profile
          <select id="fx-agent-profile" value={profile} onChange={(event) => setProfile(event.target.value)}>
            {setup.profiles.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label htmlFor="fx-agent-hosts">Hosts (optional, comma separated)<input id="fx-agent-hosts" value={hosts} onChange={(event) => setHosts(event.target.value)}/></label>
        <label htmlFor="fx-agent-tools">Tools (comma separated)<input id="fx-agent-tools" value={tools} placeholder="proxmox_read, journal_read" onChange={(event) => setTools(event.target.value)}/></label>
        <label htmlFor="fx-agent-permissions">Permissions (one "action: mode" per line)<textarea id="fx-agent-permissions" value={permissions} rows={4} onChange={(event) => setPermissions(event.target.value)}/></label>
        <label htmlFor="fx-agent-instructions">Instructions (one per line)<textarea id="fx-agent-instructions" value={instructions} rows={3} onChange={(event) => setInstructions(event.target.value)}/></label>
        <span className="fx-task-moves">
          <button type="submit" disabled={saving || !id.trim() || !name.trim() || !description.trim() || !profile}>{saving ? 'Opening pull request…' : 'Open pull request'}</button>
          <button type="button" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
        </span>
      </form>}
    {notice && <p role="status" className="v3-settings-message">{notice}</p>}
  </section>
}
