import { afterEach, describe, expect, it, vi } from 'vitest'
import { askFridayAssistant, fetchIncidentDiagnostics, fetchIncidentLogs } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('Friday assistant API', () => {
  it('posts the operator prompt and returns a typed assistant response', async () => {
    const payload = {
      available: true,
      mode: 'cloud-ai',
      provider: 'openai',
      model: 'test-model',
      text: 'All observed services are healthy.',
      fallbackUsed: false,
      attempts: [],
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await askFridayAssistant('Check service health')

    expect(result).toEqual(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/assistant', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Check service health' }),
    }))
  })

  it('passes an AbortSignal to the assistant request', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      available: true,
      mode: 'local-analysis',
      provider: 'deterministic',
      model: null,
      text: 'Preview only.',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await askFridayAssistant('show service status', controller.signal)

    expect(fetchMock).toHaveBeenCalledWith('/api/assistant', expect.objectContaining({ signal: controller.signal }))
  })

  it('throws only the safe assistant reason for non-success responses', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      available: false,
      reason: 'No configured AI provider was available.',
    }), { status: 503, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(askFridayAssistant('Check health')).rejects.toThrow('No configured AI provider was available.')
  })

  it('uses a generic safe message when the server supplies no reason', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ available: false }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(askFridayAssistant('Check health')).rejects.toThrow('Friday assistant unavailable')
  })
})

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
