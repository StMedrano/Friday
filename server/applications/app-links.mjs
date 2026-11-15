import { lstat, readFile } from 'node:fs/promises'

// "Open app" links on the Applications screen. The owner writes the file
// (default /data/app-links.json); Friday only reads it at startup. A link is
// shown for a service only when the file names that service id, so nothing a
// user types and nothing an integration reports ever becomes a link.
//
//   { "schemaVersion": 1, "links": [
//       { "serviceId": "vm100:jellyfin", "url": "https://jellyfin.example.com/" } ] }
//
// Only https URLs with no username or password. Any bad entry rejects the
// whole file, and a symlink or a group- or world-writable file is refused.

const SERVICE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const MAX_LINKS = 200
const MAX_URL = 2048

const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

export function safeAppUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL || value.trim() !== value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null
    return url.href
  } catch { return null }
}

/** Validate the owner's link file. Returns a frozen list or throws. */
export function parseAppLinks(value) {
  if (!exactKeys(value, ['schemaVersion', 'links']) || value.schemaVersion !== 1
    || !Array.isArray(value.links) || value.links.length > MAX_LINKS) throw Error('invalid-app-links')
  const seen = new Set()
  return Object.freeze(value.links.map((entry) => {
    const url = exactKeys(entry, ['serviceId', 'url']) ? safeAppUrl(entry.url) : null
    if (!url || !SERVICE.test(entry.serviceId) || seen.has(entry.serviceId)) throw Error('invalid-app-links')
    seen.add(entry.serviceId)
    return Object.freeze({ serviceId: entry.serviceId, url })
  }))
}

/** Read and validate the file; null when it is missing, unsafe or invalid. */
export async function loadAppLinks(path) {
  if (!path) return null
  try {
    const info = await lstat(path)
    if (!info.isFile() || (info.mode & 0o022) !== 0) return null
    return parseAppLinks(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}
