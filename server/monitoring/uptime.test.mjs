import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_UPTIME_SERVICES, UPTIME_HOURS, normalizeUptime, projectUptime, recordUptime } from './uptime.mjs'

const HOUR = 3600_000
const T0 = Date.parse('2026-11-05T10:00:00.000Z')
const at = (ms) => new Date(ms).toISOString()

test('records one sample per poll into hourly buckets per service', () => {
  let uptime = {}
  uptime = recordUptime(uptime, [{ id: 'plex', name: 'Plex', status: 'online' }, { id: 'nas', name: 'NAS', status: 'offline' }], at(T0 + 60_000))
  uptime = recordUptime(uptime, [{ id: 'plex', name: 'Plex', status: 'degraded' }, { id: 'nas', name: 'NAS', status: 'online' }], at(T0 + 120_000))
  uptime = recordUptime(uptime, [{ id: 'plex', name: 'Plex', status: 'maintenance' }], at(T0 + HOUR + 1))
  assert.deepEqual(uptime, {
    plex: { name: 'Plex', buckets: [[T0, 1, 1, 0, 0], [T0 + HOUR, 0, 0, 0, 1]] },
    nas: { name: 'NAS', buckets: [[T0, 1, 0, 1, 0]] },
  })
})

test('does not mutate the previous record and ignores unknown statuses and missing IDs', () => {
  const before = { plex: { name: 'Plex', buckets: [[T0, 1, 0, 0, 0]] } }
  const frozen = structuredClone(before)
  const after = recordUptime(before, [{ id: 'plex', status: 'online' }, { id: 'x', status: 'unknown' }, { status: 'online' }], at(T0 + 5))
  assert.deepEqual(before, frozen)
  assert.deepEqual(after, { plex: { name: 'Plex', buckets: [[T0, 2, 0, 0, 0]] } })
})

test('keeps only the retention window and drops services with no samples left', () => {
  let uptime = recordUptime({}, [{ id: 'old', name: 'Old', status: 'online' }, { id: 'live', name: 'Live', status: 'online' }], at(T0))
  uptime = recordUptime(uptime, [{ id: 'live', name: 'Live', status: 'online' }], at(T0 + UPTIME_HOURS * HOUR))
  assert.deepEqual(Object.keys(uptime), ['live'])
  assert.deepEqual(uptime.live.buckets, [[T0 + UPTIME_HOURS * HOUR, 1, 0, 0, 0]])
})

test('caps the number of tracked services and keeps existing ones', () => {
  const many = Array.from({ length: MAX_UPTIME_SERVICES + 5 }, (_, index) => ({ id: `s${index}`, name: `S${index}`, status: 'online' }))
  const uptime = recordUptime({}, many, at(T0))
  assert.equal(Object.keys(uptime).length, MAX_UPTIME_SERVICES)
  assert.ok(uptime.s0)
  assert.equal(uptime[`s${MAX_UPTIME_SERVICES}`], undefined)
})

test('normalizes stored data and drops malformed entries instead of failing', () => {
  assert.deepEqual(normalizeUptime(null), {})
  assert.deepEqual(normalizeUptime([]), {})
  assert.deepEqual(normalizeUptime({
    ok: { name: 'OK', buckets: [[T0, 1, 0, 0, 0], [T0 + 5, 1, 0, 0, 0], ['x', 1, 0, 0, 0], [T0 + HOUR, -1, 0, 0, 0], [T0 + 2 * HOUR, 0, 0, 0, 0]] },
    bad: { name: 'Bad', buckets: 'nope' },
    '': { name: 'Empty', buckets: [[T0, 1, 0, 0, 0]] },
    unordered: { name: 'U', buckets: [[T0 + HOUR, 1, 0, 0, 0], [T0, 1, 0, 0, 0]] },
  }), {
    ok: { name: 'OK', buckets: [[T0, 1, 0, 0, 0]] },
    unordered: { name: 'U', buckets: [[T0, 1, 0, 0, 0], [T0 + HOUR, 1, 0, 0, 0]] },
  })
})

test('projects 24 hour and 7 day uptime with maintenance excluded and degraded counted as up', () => {
  const now = T0 + 30 * HOUR + 10
  const uptime = {
    plex: { name: 'Plex', buckets: [
      [T0, 10, 0, 10, 0], // older than 24h: counts toward 7 days only
      [T0 + 29 * HOUR, 6, 2, 2, 5],
      [T0 + 30 * HOUR, 2, 0, 0, 0],
    ] },
    idle: { name: 'Idle', buckets: [[T0 + 30 * HOUR, 0, 0, 0, 3]] },
  }
  const projected = projectUptime(uptime, now)
  assert.equal(projected.generatedAt, at(now))
  assert.equal(projected.windowHours, UPTIME_HOURS)
  assert.deepEqual(projected.services, [
    {
      serviceId: 'idle', name: 'Idle',
      last24h: { uptime: null, checks: 0, degraded: 0, offline: 0 },
      last7d: { uptime: null, checks: 0, degraded: 0, offline: 0 },
      hourly: [{ at: at(T0 + 30 * HOUR), online: 0, degraded: 0, offline: 0, maintenance: 3 }],
    },
    {
      serviceId: 'plex', name: 'Plex',
      last24h: { uptime: 83.33, checks: 12, degraded: 2, offline: 2 },
      last7d: { uptime: 62.5, checks: 32, degraded: 2, offline: 12 },
      hourly: [
        { at: at(T0 + 29 * HOUR), online: 6, degraded: 2, offline: 2, maintenance: 5 },
        { at: at(T0 + 30 * HOUR), online: 2, degraded: 0, offline: 0, maintenance: 0 },
      ],
    },
  ])
})
