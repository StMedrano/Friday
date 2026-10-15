import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMonitoringHistory } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('read-only monitoring history response', () => {
  it.each([
    [503, 'monitoring-disabled', 'Monitoring disabled'],
    [503, 'monitoring-history-unavailable', 'Monitoring history unavailable'],
    [502, 'monitoring-history-invalid', 'Monitoring history response invalid'],
    [500, 'PRIVATE', 'Monitoring history unavailable'],
  ])('distinguishes safe availability errors (%s %s)', async (status,error,message) => {
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error}),{status:status as number})))
    await expect(fetchMonitoringHistory()).rejects.toThrow(message as string)
  })
  it('returns an empty list only when a valid successful response explicitly reports no events', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(fetchMonitoringHistory(controller.signal)).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/monitoring/history', { signal: controller.signal })
  })

  it.each([
    null,
    {},
    { events: null },
    { events: 'offline' },
    { events: [{ id: 'e1', type: 'incident-opened', at: 'not-a-time', source: 'monitor', detail: 'Test' }] },
    { events: [{ id: 'e1', type: 'incident-opened', at: '2026-10-15T00:00:00.000Z', source: 'monitor' }] },
  ])('rejects malformed monitoring history instead of silently displaying no incidents (%j)', async body => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
    await expect(fetchMonitoringHistory()).rejects.toThrow('Monitoring history response invalid')
  })

  it('retains valid read-only events in the original server order', async () => {
    const events = [{
      id: 'e1', type: 'incident-opened', at: '2026-10-15T00:00:00.000Z',
      source: 'monitor', host: 'vm100', detail: 'Test status', serviceName: 'AdGuard',
    }]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ events }), { status: 200 })))
    await expect(fetchMonitoringHistory()).resolves.toEqual(events)
  })
})
