import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchIncidentDiagnostics, fetchIncidentLogs } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('incident diagnostics API', () => {
  it('fetches incident diagnostics with GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      incidentId: 'i1',
      status: 'available',
      facts: [],
      findings: [],
      likelyCauses: [],
      recommendations: [],
      logsAvailable: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIncidentDiagnostics('i1')

    expect(result.status).toBe('available')
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/diagnostics', expect.objectContaining({ method: 'GET' }))
  })

  it('fetches explicit read-only logs with GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      incidentId: 'i1',
      logs: 'safe log',
      tail: 100,
      truncated: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchIncidentLogs('i1')

    expect(result.logs).toBe('safe log')
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/logs', expect.objectContaining({ method: 'GET' }))
  })

  it('encodes incident ids before placing them in a path', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      incidentId: 'incident/one',
      status: 'not-supported',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchIncidentDiagnostics('incident/one')

    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/incident%2Fone/diagnostics', expect.objectContaining({ method: 'GET' }))
  })

  it('surfaces a safe server error without retrying as a write request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'diagnostics-disabled' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchIncidentDiagnostics('i1')).rejects.toThrow('diagnostics-disabled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/diagnostics', expect.objectContaining({ method: 'GET' }))
  })
})
