import { useEffect, useState, type FormEvent } from 'react'
import { FolderGit2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createRepositoryEntry, deleteRepositoryEntry, fetchRepositorySettings, FridayRepositorySettingsError, updateRepositoryEntry,
  type FridayRepositoryEntry, type FridayRepositoryEntryInput, type FridayRepositorySettings,
} from '../lib/api'

const ERRORS: Record<string, string> = {
  'invalid-repository-name': 'Give the repository a name (up to 120 characters).',
  'invalid-repository-path': 'The checkout path must be an absolute container path.',
  'invalid-repository-remote': 'The remote must be an https, http, ssh or git URL.',
  'invalid-repository-branch': 'The default branch name is not valid.',
  'invalid-repository-exclude': 'Excluded paths must be relative patterns such as drafts/**.',
  'invalid-repository-mode': 'Repositories added here are read only.',
  'repository-id-immutable': 'A repository keeps its ID; remove it and add a new one instead.',
  'repository-not-git': 'That path is not a Git checkout on the controller.',
  'repository-exists': 'A repository with that name already exists.',
  'repository-limit': 'Friday registers at most 32 repositories.',
  'repository-not-found': 'That repository no longer exists. Reload Settings.',
  'audit-unavailable': 'The action audit could not record this change, so it was not saved.',
}

type Draft = { name: string; path: string; remote: string; defaultBranch: string; exclude: string; enabled: boolean }
const EMPTY: Draft = { name: '', path: '', remote: '', defaultBranch: 'main', exclude: '', enabled: true }
const toDraft = (entry: FridayRepositoryEntry): Draft => ({
  name: entry.name, path: entry.path, remote: entry.remote || '', defaultBranch: entry.defaultBranch, exclude: entry.exclude.join(', '), enabled: entry.enabled,
})
const toInput = (draft: Draft): FridayRepositoryEntryInput => ({
  name: draft.name.trim(),
  path: draft.path.trim(),
  ...(draft.remote.trim() ? { remote: draft.remote.trim() } : {}),
  defaultBranch: draft.defaultBranch.trim() || 'main',
  enabled: draft.enabled,
  exclude: draft.exclude.split(',').map((item) => item.trim()).filter(Boolean),
})

function failure(reason: unknown, roots: string[]) {
  if (reason instanceof FridayRepositorySettingsError) {
    if (reason.status === 403) return 'Operator access is required to change repositories.'
    if (reason.code === 'repository-path-not-allowed') return `The path must be a checkout inside ${roots.join(' or ') || 'an allowed root'}.`
    return ERRORS[reason.code] || 'The repository could not be saved.'
  }
  return 'The repository could not be saved.'
}

function RepositoryForm({ label, draft, onChange, onSubmit, submit, busy, onCancel }: {
  label: string; draft: Draft; onChange: (draft: Draft) => void; onSubmit: () => void; submit: string; busy: boolean; onCancel?: () => void
}) {
  const field = (key: Exclude<keyof Draft, 'enabled'>) => ({ value: draft[key], onChange: (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value }) })
  const handle = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  return <form className="v3-settings-form" aria-label={label} onSubmit={handle}>
    <label>Name <input maxLength={120} {...field('name')}/></label>
    <label>Checkout path <input maxLength={1024} placeholder="/repositories/name" {...field('path')}/></label>
    <label>Remote URL <input maxLength={2048} placeholder="optional" {...field('remote')}/></label>
    <label>Default branch <input maxLength={100} {...field('defaultBranch')}/></label>
    <label>Excluded paths <input placeholder="drafts/**, tmp" {...field('exclude')}/></label>
    <label><input type="checkbox" checked={draft.enabled} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}/> Enabled</label>
    <button type="submit" disabled={busy}>{submit === 'Add repository' ? <Plus size={14} aria-hidden="true"/> : null}{submit}</button>
    {onCancel && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
  </form>
}

export default function RepositorySettingsPanel() {
  const [view, setView] = useState<FridayRepositorySettings | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'saving'>('loading')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchRepositorySettings(controller.signal)
      .then((next) => { setView(next); setState('ready') })
      .catch((reason) => { if (reason?.name !== 'AbortError') setState('unavailable') })
    return () => controller.abort()
  }, [])

  const run = async (action: () => Promise<FridayRepositorySettings>, done: string, after?: () => void) => {
    setState('saving')
    setMessage('')
    try {
      setView(await action())
      after?.()
      setMessage(done)
    } catch (reason) {
      setMessage(failure(reason, view?.allowedRoots || []))
    }
    setState('ready')
  }

  const add = () => {
    const input = toInput(draft)
    return run(() => createRepositoryEntry(input), `${input.name} added.`, () => setDraft(EMPTY))
  }
  const save = () => {
    if (!editing) return
    const input = toInput(editing.draft)
    return run(() => updateRepositoryEntry(editing.id, input), `${input.name} saved.`, () => setEditing(null))
  }
  const remove = (entry: FridayRepositoryEntry) => run(() => deleteRepositoryEntry(entry.id), `${entry.name} removed.`)

  const busy = state === 'saving'
  const repositories = view?.repositories || []
  return <section className="v3-panel v3-settings-wide" aria-label="Repository settings">
    <div className="v3-section-head"><div><span className="v3-kicker">REPOSITORIES</span><h2>{view ? `${repositories.length} of ${view.limit} ${repositories.length === 1 ? 'repository' : 'repositories'}` : 'Repositories'}</h2></div><FolderGit2 size={16} aria-hidden="true"/></div>
    {state === 'loading' ? <p role="status" className="v3-settings-message">Loading repositories…</p>
      : state === 'unavailable' || !view ? <p role="status" className="v3-settings-message">Repository settings are unavailable on this controller.</p>
        : <>
          <p className="v3-settings-message">{view.managed ? 'Managed here. These replace the mounted registry file.' : 'From the mounted registry file. The first change here copies it into Friday settings.'} New checkouts must already be mounted inside {view.allowedRoots.join(' or ') || 'an allowed root'}.</p>
          <ul className="v3-settings-list" aria-label="Repositories">
            {repositories.map((entry) => <li key={entry.id}>
              {editing?.id === entry.id
                ? <RepositoryForm label={`Edit ${entry.name}`} draft={editing.draft} onChange={(next) => setEditing({ id: entry.id, draft: next })} onSubmit={save} submit="Save repository" busy={busy} onCancel={() => setEditing(null)}/>
                : <>
                  <span className="v3-settings-name"><b>{entry.name}</b><small>{entry.enabled ? 'Enabled' : 'Disabled'} · {entry.mode} · {entry.path} · {entry.defaultBranch}</small></span>
                  <span>
                    <button type="button" className="text-button" onClick={() => setEditing({ id: entry.id, draft: toDraft(entry) })} aria-label={`Edit ${entry.name}`} disabled={busy}><Pencil size={14} aria-hidden="true"/></button>
                    <button type="button" className="text-button" onClick={() => remove(entry)} aria-label={`Remove ${entry.name}`} disabled={busy}><Trash2 size={14} aria-hidden="true"/></button>
                  </span>
                </>}
            </li>)}
          </ul>
          <RepositoryForm label="Add repository" draft={draft} onChange={setDraft} onSubmit={add} submit="Add repository" busy={busy || repositories.length >= view.limit}/>
          {message && <p role="status" className="v3-settings-message">{message}</p>}
          <p className="v3-settings-message">Operators only. Changes are recorded in the action audit. Friday only reads registered checkouts; it never writes to them or runs Git commands that change them.</p>
        </>}
  </section>
}
