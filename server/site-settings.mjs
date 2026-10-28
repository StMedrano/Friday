import {mkdir, readFile, rename, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

// Operator-editable site labels for adapters that have no site data of their
// own, plus the declared site list. Stored on the Friday data volume; the
// environment's FRIDAY_*_SITE values remain the defaults.
export const SITE_SOURCES = Object.freeze([
  {id: 'proxmox', configKey: 'proxmox', name: 'Proxmox VE'},
  {id: 'vm100-observer', configKey: 'vm100Observer', name: 'VM100 Docker observer'},
  {id: 'docker', configKey: 'docker', name: 'Local Docker (VM102)'},
  {id: 'endpoints', configKey: 'endpoints', name: 'HTTP endpoint URLs'},
])
const SOURCE_IDS = new Set(SITE_SOURCES.map(source => source.id))
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,47}$/u
const MAX_SITES = 8
const EMPTY = Object.freeze({sources: {}, sites: []})

const rejected = reason => { const error = new Error(reason); error.code = 'invalid-site-settings'; throw error }
const label = value => typeof value === 'string' && LABEL.test(value.trim()) && value.trim() === value.replace(/\s+/g, ' ').trim()
const slug = name => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'site'

/** Validate and normalise a submitted settings document; throws invalid-site-settings. */
export function validateSiteSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) rejected('settings-object-required')
  const extra = Object.keys(input).filter(key => key !== 'sources' && key !== 'sites')
  if (extra.length) rejected('unknown-field')
  const rawSites = input.sites ?? []
  const rawSources = input.sources ?? {}
  if (!Array.isArray(rawSites) || rawSites.length > MAX_SITES) rejected('invalid-sites')
  if (!rawSources || typeof rawSources !== 'object' || Array.isArray(rawSources)) rejected('invalid-sources')

  const sites = rawSites.map(site => {
    const name = typeof site === 'string' ? site : site?.name
    if (!label(name)) rejected('invalid-site-name')
    return {id: slug(name.trim()), name: name.trim()}
  })
  if (new Set(sites.map(site => site.id)).size !== sites.length) rejected('duplicate-site')

  const declared = new Set(sites.map(site => site.name))
  const sources = {}
  for (const [id, value] of Object.entries(rawSources)) {
    if (!SOURCE_IDS.has(id)) rejected('unknown-source')
    if (value === null || value === '') continue
    if (!label(value)) rejected('invalid-source-site')
    if (sites.length && !declared.has(value.trim())) rejected('undeclared-source-site')
    sources[id] = value.trim()
  }
  return {sources, sites}
}

/** Effective adapter config: stored labels override environment defaults. */
export function applySiteSettings(config, settings = EMPTY) {
  const next = {...config, declaredSites: settings.sites.map(site => ({...site}))}
  for (const source of SITE_SOURCES) {
    const site = settings.sources[source.id]
    if (site && config[source.configKey]) next[source.configKey] = {...config[source.configKey], site}
  }
  return next
}

/** Declared sites with status and counts derived only from observed member services. */
export function deriveSites(declared = [], services = []) {
  return declared.map(site => {
    const members = services.filter(service => service?.site === site.name || service?.site === site.id)
    const online = members.filter(service => service.status === 'online').length
    const status = !members.length ? 'maintenance' : online === members.length ? 'online' : online ? 'degraded' : 'offline'
    return {id: site.id, name: site.name, location: 'Declared in Friday settings', status, devicesOnline: online, devicesTotal: members.length}
  })
}

export function siteSettingsView(config, settings = EMPTY) {
  return {
    sites: settings.sites.map(site => ({...site})),
    sources: SITE_SOURCES.map(source => ({
      id: source.id,
      name: source.name,
      site: settings.sources[source.id] || null,
      defaultSite: config[source.configKey]?.site || 'Site A',
      enabled: config[source.configKey]?.enabled === true,
    })),
  }
}

export async function createSiteSettingsStore({path, fs = {mkdir, readFile, rename, writeFile}} = {}) {
  let current = EMPTY
  if (path) {
    try { current = validateSiteSettings(JSON.parse(await fs.readFile(path, 'utf8'))) }
    catch (error) {
      if (error?.code !== 'ENOENT') console.warn('Friday site settings could not be loaded; using environment defaults')
    }
  }
  return {
    get() { return current },
    async save(input) {
      const next = validateSiteSettings(input)
      if (!path) throw Object.assign(new Error('site-settings-unavailable'), {code: 'site-settings-unavailable'})
      await fs.mkdir(dirname(path), {recursive: true})
      const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', {mode: 0o600})
      await fs.rename(temporary, path)
      current = next
      return next
    },
  }
}
