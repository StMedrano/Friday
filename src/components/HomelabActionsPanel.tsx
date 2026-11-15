import { FormEvent, useCallback, useEffect, useState } from 'react'
import NotConnected from './NotConnected'
import {
  fetchFridayHomelabActions, FridayHomelabError, previewFridayHomelabAction, runFridayHomelabAction,
  type FridayHomelabActionsResult, type FridayHomelabOperation, type FridayHomelabPreview,
} from '../lib/api'

const OPERATION_LABEL: Record<FridayHomelabOperation, string> = { start: 'Start', shutdown: 'Shut down', reboot: 'Reboot' }

const ERRORS: Record<string, string> = {
  'homelab-confirm-mismatch': 'The name you typed does not match. Nothing was changed.',
  'homelab-preview-expired': 'That preview expired or was already used. Preview again.',
  'homelab-preview-not-yours': 'Only the operator who asked for the preview can approve it.',
  'homelab-state-changed': 'The guest changed state since the preview, so nothing was done. Preview again.',
  'automation-gate-closed': 'The automation gate on the Friday host is not armed, so nothing was changed.',
  'homelab-operation-not-allowed': 'That operation is not allowed for this guest.',
  'access-denied': 'Only signed-in operators can make homelab changes.',
  'audit-unavailable': 'The action audit is unavailable, so nothing was changed.',
}

const guestLabel = (guestType: string, vmid: number) => `${guestType === 'lxc' ? 'CT' : 'VM'} ${vmid}`

/**
 * Homelab changes: the owner's listed Proxmox guests. Every change is a dry-run
 * preview first, then the operator types the guest's name to approve one run.
 */
export default function HomelabActionsPanel() {
  const [view, setView] = useState<FridayHomelabActionsResult | null>(null)
  const [preview, setPreview] = useState<FridayHomelabPreview | null>(null)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback((signal?: AbortSignal) => {
    fetchFridayHomelabActions(signal).then(setView).catch(() => { if (!signal?.aborted) setView({ state: 'unavailable' }) })
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (!view) return <p className="v3-settings-message" role="status">Loading homelab changes…</p>
  if (view.state === 'disabled') return <NotConnected title="Homelab changes"
    detail="Starting, shutting down or rebooting Proxmox guests needs the owner's action file and a scoped Proxmox token (FRIDAY_HOMELAB_ACTIONS_ENABLED) on the server."
    action="Preview" setup="Homelab changes" />
  if (view.state === 'unavailable') return <p className="v3-settings-message" role="status">Homelab changes could not be loaded.</p>

  async function ask(actionId: string, operation: FridayHomelabOperation) {
    setBusy(true); setNotice(''); setConfirm('')
    try { setPreview(await previewFridayHomelabAction(actionId, operation)) }
    catch (error) { setPreview(null); setNotice(ERRORS[error instanceof FridayHomelabError ? error.code : ''] || 'The preview failed. Nothing was changed.') }
    finally { setBusy(false) }
  }

  async function approve(event: FormEvent) {
    event.preventDefault()
    if (!preview?.planId) return
    setBusy(true)
    try {
      const result = await runFridayHomelabAction(preview.planId, confirm)
      const what = `${OPERATION_LABEL[result.run.operation]} ${result.run.name}`
      setNotice(result.execution.performed
        ? `${what}: sent to Proxmox.`
        : `${what}: dry run recorded. Nothing was changed.`)
      setPreview(null); setConfirm('')
      load()
    } catch (error) {
      const code = error instanceof FridayHomelabError ? error.code : ''
      setNotice(ERRORS[code] || 'The change failed. Check the run list and Proxmox before trying again.')
      if (code !== 'homelab-confirm-mismatch') setPreview(null)
      load()
    } finally { setBusy(false) }
  }

  const dryRun = view.mode === 'dry-run'
  return <section className="v3-section fx-homelab" aria-label="Homelab changes">
    <div className="v3-section-head"><div>
      <span className="v3-kicker">HOMELAB CHANGES · {dryRun ? 'DRY RUN' : 'LIVE'}</span>
      <h2>Proxmox guests</h2>
      <p className="fx-homelab-note">{dryRun
        ? 'Dry-run mode: approving records what would happen and changes nothing.'
        : 'Each change is previewed first and runs once after you type the guest name. The automation gate on the Friday host must be armed.'}</p>
    </div></div>
    {view.actions.length === 0
      ? <p className="v3-settings-message">The owner's action file lists no guests.</p>
      : <ul className="fx-homelab-list">{view.actions.map((action) => <li key={action.id}>
        <div><b>{action.name}</b><small>{guestLabel(action.guestType, action.vmid)} on {action.node}{action.description ? ` · ${action.description}` : ''}</small></div>
        <span className={`fx-status ${action.status === 'running' ? 'online' : action.status === 'stopped' ? 'offline' : 'unknown'}`}>{action.status}</span>
        <span className="fx-homelab-ops">{action.operations.map((operation) =>
          <button key={operation} type="button" className="fx-button" disabled={busy}
            aria-label={`Preview ${OPERATION_LABEL[operation].toLowerCase()} ${action.name}`}
            onClick={() => void ask(action.id, operation)}>{OPERATION_LABEL[operation]}</button>)}</span>
      </li>)}</ul>}

    {preview && <div className="fx-homelab-preview" role="region" aria-label="Change preview">
      <p><b>Preview ({preview.mode === 'dry-run' ? 'dry run' : 'live'}):</b> {preview.summary}</p>
      {preview.allowed && preview.planId
        ? <form onSubmit={(event) => void approve(event)}>
          <label>Type <code>{preview.confirmText}</code> to approve
            <input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" spellCheck={false} /></label>
          <button type="submit" className="fx-button primary" disabled={busy || confirm !== preview.confirmText}>
            {preview.mode === 'dry-run' ? 'Approve dry run' : `Approve and ${OPERATION_LABEL[preview.operation].toLowerCase()}`}</button>
          <button type="button" className="fx-button" onClick={() => { setPreview(null); setConfirm('') }}>Cancel</button>
          <small>This preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}.</small>
        </form>
        : <button type="button" className="fx-button" onClick={() => setPreview(null)}>Close</button>}
    </div>}
    {notice && <p role="status" className="v3-settings-message">{notice}</p>}

    {view.recent.length > 0 && <div className="fx-homelab-recent">
      <h3>Recent changes</h3>
      <ul>{view.recent.slice(0, 8).map((run) => <li key={run.id}>
        <span>{OPERATION_LABEL[run.operation]} {run.name ?? run.actionId}</span>
        <span className="fx-pill">{run.state}</span>
        <small>{new Date(run.at).toLocaleString()}{run.requestedBy ? ` · ${run.requestedBy}` : ''}{run.detail ? ` · ${run.detail}` : ''}</small>
      </li>)}</ul>
    </div>}
  </section>
}
