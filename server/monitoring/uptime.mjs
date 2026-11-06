// Per-service uptime record built from the monitoring poll itself: one sample
// per service per poll, folded into hourly buckets and kept for seven days.
// Bucket: [hourStartMs, online, degraded, offline, maintenance].
// Maintenance (an intentionally stopped guest) is never counted as downtime.

export const UPTIME_HOURS = 168
export const MAX_UPTIME_SERVICES = 300
const HOUR = 3600_000
const STATUS_INDEX = { online: 1, degraded: 2, offline: 3, maintenance: 4 }

const hourOf = (ms) => Math.floor(ms / HOUR) * HOUR
const count = (value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000

function validBucket(bucket) {
  return Array.isArray(bucket) && bucket.length === 5 && Number.isSafeInteger(bucket[0]) && bucket[0] > 0 && bucket[0] % HOUR === 0
    && bucket.slice(1).every(count) && bucket.slice(1).some((value) => value > 0)
}

export function normalizeUptime(value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [id, entry] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_UPTIME_SERVICES) break
    if (!id || id.length > 200 || !entry || typeof entry !== 'object' || !Array.isArray(entry.buckets)) continue
    const seen = new Set()
    const buckets = entry.buckets.filter(validBucket)
      .filter((bucket) => !seen.has(bucket[0]) && seen.add(bucket[0]))
      .sort((a, b) => a[0] - b[0])
      .slice(-UPTIME_HOURS)
      .map((bucket) => [...bucket])
    if (buckets.length) result[id] = { name: typeof entry.name === 'string' ? entry.name.slice(0, 200) : id, buckets }
  }
  return result
}

export function recordUptime(previous, services, now) {
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new Error('Invalid uptime timestamp')
  const hour = hourOf(nowMs)
  const cutoff = hour - (UPTIME_HOURS - 1) * HOUR
  const next = {}
  for (const [id, entry] of Object.entries(previous || {})) {
    const buckets = (entry?.buckets || []).filter((bucket) => bucket[0] >= cutoff).map((bucket) => [...bucket])
    if (buckets.length) next[id] = { name: entry.name, buckets }
  }
  for (const service of services || []) {
    const id = typeof service?.id === 'string' ? service.id.slice(0, 200) : ''
    const index = STATUS_INDEX[service?.status]
    if (!id || !index) continue
    let entry = next[id]
    if (!entry) {
      if (Object.keys(next).length >= MAX_UPTIME_SERVICES) continue
      entry = next[id] = { name: String(service.name || id).slice(0, 200), buckets: [] }
    } else if (service.name) entry.name = String(service.name).slice(0, 200)
    let bucket = entry.buckets.at(-1)
    if (!bucket || bucket[0] !== hour) {
      bucket = [hour, 0, 0, 0, 0]
      entry.buckets.push(bucket)
    }
    bucket[index] += 1
  }
  return next
}

function windowSummary(buckets) {
  let online = 0, degraded = 0, offline = 0
  for (const bucket of buckets) { online += bucket[1]; degraded += bucket[2]; offline += bucket[3] }
  const checks = online + degraded + offline
  return { uptime: checks ? Math.round(((online + degraded) / checks) * 10000) / 100 : null, checks, degraded, offline }
}

export function projectUptime(uptime, nowMs = Date.now()) {
  const hour = hourOf(nowMs)
  const services = Object.entries(normalizeUptime(uptime)).map(([serviceId, entry]) => {
    const week = entry.buckets.filter((bucket) => bucket[0] >= hour - (UPTIME_HOURS - 1) * HOUR && bucket[0] <= hour)
    const day = week.filter((bucket) => bucket[0] >= hour - 23 * HOUR)
    return {
      serviceId,
      name: entry.name,
      last24h: windowSummary(day),
      last7d: windowSummary(week),
      hourly: day.map(([at, online, degraded, offline, maintenance]) => ({ at: new Date(at).toISOString(), online, degraded, offline, maintenance })),
    }
  }).sort((a, b) => a.name.localeCompare(b.name) || a.serviceId.localeCompare(b.serviceId))
  return { generatedAt: new Date(nowMs).toISOString(), windowHours: UPTIME_HOURS, services }
}
