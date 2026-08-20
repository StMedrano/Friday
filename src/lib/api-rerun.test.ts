import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rerunIncidentDiagnostics', () => {
  it('POSTs only to the incident-scoped diagnostics rerun route and returns the refreshed report', async () => {
    const rerun = (api as typeof api & { rerunIncidentDiagnostics?: (incidentId: string, signal?: AbortSignal) => Promise<api.DiagnosticReport> }).rerunIncidentDiagnostics
    expect(typeof rerun).toBe('function')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      incidentId: 'i1', status: 'available', findings: ['fresh diagnosis'],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const controller = new AbortController()
    const result = await rerun!('i1', controller.signal)

    expect(result.findings).toEqual(['fresh diagnosis'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/i1/diagnostics/rerun', {
      method: 'POST',
      signal: controller.signal,
    })
  })
})
