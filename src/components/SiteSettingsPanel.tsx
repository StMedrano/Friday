import { useEffect, useState } from 'react'
import { MapPin, Plus, Trash2 } from 'lucide-react'
import { fetchSiteSettings, FridaySiteSettingsError, saveSiteSettings, type FridaySiteSettings } from '../lib/api'

const ERRORS: Record<string, string> = {
  'invalid-site-name': 'Site names use letters, numbers, spaces, dots, dashes or apostrophes (up to 48 characters).',
  'invalid-source-site': 'Source site labels use letters, numbers, spaces, dots, dashes or apostrophes (up to 48 characters).',
  'duplicate-site': 'Each site name must be unique.',
  'invalid-sites': 'Up to 8 sites can be declared.',
  'undeclared-source-site': 'Assign each source to one of the declared sites.',
  'audit-unavailable': 'The action audit could not record this change, so it was not saved.',
}

function saveFailure(reason: unknown) {
  if (reason instanceof FridaySiteSettingsError) {
    if (reason.status === 403) return 'Operator access is required to change sites.'
    return ERRORS[reason.code] || 'Sites could not be saved.'
  }
  return 'Sites could not be saved.'
}

export default function SiteSettingsPanel() {
  const [view, setView] = useState<FridaySiteSettings | null>(null)
  const [sites, setSites] = useState<string[]>([])
  const [sources, setSources] = useState<Record<string, string>>({})
  const [newSite, setNewSite] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'saving'>('loading')
  const [message, setMessage] = useState('')

  const load = (next: FridaySiteSettings) => {
    setView(next)
    setSites(next.sites.map((site) => site.name))
    setSources(Object.fromEntries(next.sources.map((source) => [source.id, source.site || ''])))
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchSiteSettings(controller.signal)
      .then((next) => { load(next); setState('ready') })
      .catch((reason) => { if (reason?.name !== 'AbortError') setState('unavailable') })
    return () => controller.abort()
  }, [])

  const addSite = () => {
    const name = newSite.trim()
    if (!name || sites.includes(name)) return
    setSites([...sites, name])
    setNewSite('')
  }
  const removeSite = (name: string) => {
    setSites(sites.filter((site) => site !== name))
    setSources(Object.fromEntries(Object.entries(sources).map(([id, site]) => [id, site === name ? '' : site])))
  }
  const save = async () => {
    setState('saving')
    setMessage('')
    try {
      const next = await saveSiteSettings({ sites, sources: Object.fromEntries(Object.entries(sources).map(([id, site]) => [id, site || null])) })
      load(next)
      setMessage('Sites saved. Labels apply at the next monitoring poll.')
    } catch (reason) {
      setMessage(saveFailure(reason))
    }
    setState('ready')
  }

  return <section className="v3-panel v3-settings-wide" aria-label="Sites">
    <div className="v3-section-head"><div><span className="v3-kicker">SITES</span><h2>{state === 'ready' || state === 'saving' ? `${sites.length} declared ${sites.length === 1 ? 'site' : 'sites'}` : 'Sites'}</h2></div><MapPin size={16} aria-hidden="true"/></div>
    {state === 'loading' ? <p role="status" className="v3-settings-message">Loading sites…</p>
      : state === 'unavailable' || !view ? <p role="status" className="v3-settings-message">Site settings are unavailable on this controller.</p>
        : <>
          <ul className="v3-settings-list compact" aria-label="Declared sites">
            {sites.map((site) => <li key={site}>
              <span className="v3-settings-name"><b>{site}</b></span>
              <button type="button" className="text-button" onClick={() => removeSite(site)} aria-label={`Remove ${site}`}><Trash2 size={14} aria-hidden="true"/></button>
            </li>)}
          </ul>
          <div className="v3-settings-form">
            <label>New site <input value={newSite} maxLength={48} onChange={(event) => setNewSite(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSite() } }}/></label>
            <button type="button" className="text-button" onClick={addSite}><Plus size={14} aria-hidden="true"/>Add site</button>
          </div>
          <ul className="v3-settings-list" aria-label="Source sites">
            {view.sources.map((source) => <li key={source.id}>
              <span className="v3-settings-name"><b>{source.name}</b><small>{source.enabled ? 'Enabled' : 'Disabled'} · default {source.defaultSite}</small></span>
              <label className="v3-settings-select">Site for {source.name}
                {sites.length
                  ? <select value={sources[source.id] || ''} onChange={(event) => setSources({ ...sources, [source.id]: event.target.value })}>
                    <option value="">Default ({source.defaultSite})</option>
                    {sites.map((site) => <option key={site} value={site}>{site}</option>)}
                  </select>
                  : <input value={sources[source.id] || ''} maxLength={48} placeholder={source.defaultSite} onChange={(event) => setSources({ ...sources, [source.id]: event.target.value })}/>}
              </label>
            </li>)}
          </ul>
          <div className="v3-settings-form">
            <button type="button" onClick={save} disabled={state === 'saving'}>{state === 'saving' ? 'Saving…' : 'Save sites'}</button>
            {message && <p role="status" className="v3-settings-message">{message}</p>}
          </div>
          <p className="v3-settings-message">Operators only. Changes are recorded in the action audit. They relabel what Friday observes and never change infrastructure.</p>
        </>}
  </section>
}
