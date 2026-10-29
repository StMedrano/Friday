import { useEffect, useState, type FormEvent } from 'react'
import { Globe, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createEndpointCheck, deleteEndpointCheck, fetchEndpointChecks, FridayEndpointChecksError, updateEndpointCheck,
  type FridayEndpointCheck, type FridayEndpointCheckInput, type FridayEndpointChecks,
} from '../lib/api'

const ERRORS: Record<string, string> = {
  'invalid-endpoint-check': 'Check the fields: a name and site (up to 80 characters) and an http(s) URL without credentials, query or fragment.',
  'endpoint-id-immutable': 'A check keeps its ID; delete it and add a new one instead.',
  'endpoint-check-exists': 'A check with that name already exists.',
  'endpoint-check-limit': 'Friday monitors at most 16 endpoint checks.',
  'endpoint-check-not-found': 'That check no longer exists. Reload Settings.',
  'audit-unavailable': 'The action audit could not record this change, so it was not saved.',
}

type Draft = { name: string; site: string; url: string; statuses: string }
const EMPTY: Draft = { name: '', site: '', url: '', statuses: '' }
const toDraft = (check: FridayEndpointCheck): Draft =>
  ({ name: check.name, site: check.site, url: check.url, statuses: check.expectedStatuses?.join(', ') || '' })

function toInput(draft: Draft): FridayEndpointCheckInput | null {
  const raw = draft.statuses.split(',').map((item) => item.trim()).filter(Boolean)
  if (raw.some((item) => !/^\d{3}$/.test(item))) return null
  return { name: draft.name.trim(), site: draft.site.trim(), url: draft.url.trim(), expectedStatuses: raw.length ? raw.map(Number) : null }
}

function failure(reason: unknown) {
  if (reason instanceof FridayEndpointChecksError) {
    if (reason.status === 403) return 'Operator access is required to change endpoint checks.'
    return ERRORS[reason.code] || 'The endpoint check could not be saved.'
  }
  return 'The endpoint check could not be saved.'
}

function CheckForm({ label, draft, onChange, onSubmit, submit, busy, onCancel }: {
  label: string; draft: Draft; onChange: (draft: Draft) => void; onSubmit: () => void; submit: string; busy: boolean; onCancel?: () => void
}) {
  const field = (key: keyof Draft) => ({ value: draft[key], onChange: (event: { target: { value: string } }) => onChange({ ...draft, [key]: event.target.value }) })
  const handle = (event: FormEvent) => { event.preventDefault(); onSubmit() }
  return <form className="v3-settings-form" aria-label={label} onSubmit={handle}>
    <label>Name <input maxLength={80} {...field('name')}/></label>
    <label>Site <input maxLength={80} {...field('site')}/></label>
    <label>URL <input type="url" maxLength={2048} placeholder="https://host/path" {...field('url')}/></label>
    <label>Expected HTTP statuses <input placeholder="any 2xx" {...field('statuses')}/></label>
    <button type="submit" disabled={busy}>{submit === 'Add check' ? <Plus size={14} aria-hidden="true"/> : null}{submit}</button>
    {onCancel && <button type="button" className="text-button" onClick={onCancel}>Cancel</button>}
  </form>
}

export default function EndpointChecksPanel() {
  const [view, setView] = useState<FridayEndpointChecks | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'saving'>('loading')
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchEndpointChecks(controller.signal)
      .then((next) => { setView(next); setState('ready') })
      .catch((reason) => { if (reason?.name !== 'AbortError') setState('unavailable') })
    return () => controller.abort()
  }, [])

  const run = async (action: () => Promise<FridayEndpointChecks>, done: string, after?: () => void) => {
    setState('saving')
    setMessage('')
    try {
      setView(await action())
      after?.()
      setMessage(`${done} Monitoring picks it up at the next poll.`)
    } catch (reason) {
      setMessage(failure(reason))
    }
    setState('ready')
  }
  const invalidStatuses = () => setMessage('Expected statuses are HTTP codes separated by commas, such as 200, 302. Leave empty to accept any 2xx.')

  const add = () => {
    const input = toInput(draft)
    if (!input) return invalidStatuses()
    return run(() => createEndpointCheck(input), `${input.name} added.`, () => setDraft(EMPTY))
  }
  const save = () => {
    if (!editing) return
    const input = toInput(editing.draft)
    if (!input) return invalidStatuses()
    return run(() => updateEndpointCheck(editing.id, input), `${input.name} saved.`, () => setEditing(null))
  }
  const remove = (check: FridayEndpointCheck) => run(() => deleteEndpointCheck(check.id), `${check.name} deleted.`)

  const busy = state === 'saving'
  const checks = view?.checks || []
  return <section className="v3-panel v3-settings-wide" aria-label="Endpoint checks">
    <div className="v3-section-head"><div><span className="v3-kicker">ENDPOINT CHECKS</span><h2>{view ? `${checks.length} of ${view.limit} endpoint ${checks.length === 1 ? 'check' : 'checks'}` : 'Endpoint checks'}</h2></div><Globe size={16} aria-hidden="true"/></div>
    {state === 'loading' ? <p role="status" className="v3-settings-message">Loading endpoint checks…</p>
      : state === 'unavailable' || !view ? <p role="status" className="v3-settings-message">Endpoint checks are unavailable on this controller.</p>
        : <>
          <p className="v3-settings-message">{view.managed ? 'Managed here. These replace the environment checks.' : 'From the server environment. The first change here copies them into Friday settings.'}{view.enabled ? '' : ' The endpoint adapter is disabled, so nothing is polled until FRIDAY_ENDPOINTS_ENABLED=true.'}</p>
          <ul className="v3-settings-list" aria-label="Endpoint checks">
            {checks.map((check) => <li key={check.id}>
              {editing?.id === check.id
                ? <CheckForm label={`Edit ${check.name}`} draft={editing.draft} onChange={(next) => setEditing({ id: check.id, draft: next })} onSubmit={save} submit="Save check" busy={busy} onCancel={() => setEditing(null)}/>
                : <>
                  <span className="v3-settings-name"><b>{check.name}</b><small>{check.site} · {check.url} · {check.expectedStatuses?.join(', ') || 'any 2xx'}</small></span>
                  <span>
                    <button type="button" className="text-button" onClick={() => setEditing({ id: check.id, draft: toDraft(check) })} aria-label={`Edit ${check.name}`} disabled={busy}><Pencil size={14} aria-hidden="true"/></button>
                    <button type="button" className="text-button" onClick={() => remove(check)} aria-label={`Delete ${check.name}`} disabled={busy}><Trash2 size={14} aria-hidden="true"/></button>
                  </span>
                </>}
            </li>)}
          </ul>
          <CheckForm label="Add endpoint check" draft={draft} onChange={setDraft} onSubmit={add} submit="Add check" busy={busy || checks.length >= view.limit}/>
          {message && <p role="status" className="v3-settings-message">{message}</p>}
          <p className="v3-settings-message">Operators only. Changes are recorded in the action audit. Friday only sends a GET to each URL; nothing on the target is changed.</p>
        </>}
  </section>
}
