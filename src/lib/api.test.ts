import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askFridayAgent,
  askFridayAssistant,
  fetchFridayAgentRegistryStatus,
  fetchFridayAgents,
  fetchIncidentDiagnostics,
  fetchIncidentLogs,
  routeFridayAgent,
  syncFridayAgentRegistry,
} from './api'

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
      body: JSON.stringify({ prompt: 'Check service health', history: [] }),
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

    await askFridayAssistant('show service status', { signal: controller.signal })

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

describe('Friday local agent API', () => {
  it('lists registered agents and reads registry status with GET', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/registry/status')
        ? { id: 'git', status: 'ok', agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [] }
        : [{ id: 'proxmox-observer', name: 'Proxmox Observer', enabled: true, model: { profile: 'local-general' }, scope: {}, tools: [], permissions: {}, source: { path: 'agents/proxmox-observer.json', checksum: 'abc', syncedAt: '2026-08-30T00:00:00Z' } }]
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    expect((await fetchFridayAgents())[0].id).toBe('proxmox-observer')
    expect((await fetchFridayAgentRegistryStatus()).status).toBe('ok')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agents', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agents/registry/status', expect.objectContaining({ method: 'GET' }))
  })

  it('syncs only from Git with an empty POST body object', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', agentsSynced: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await syncFridayAgentRegistry()

    expect(fetchMock).toHaveBeenCalledWith('/api/agents/registry/sync', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }))
  })

  it('routes automatically and manually asks an encoded selected agent', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/route')
        ? { matched: true, agentId: 'agent/one', agentName: 'Agent One', routing: 'deterministic', confidence: 0.9, reason: 'match' }
        : { available: true, mode: 'local-agent', provider: 'ollama', agentId: 'agent/one', agentName: 'Agent One', modelProfile: 'local-general', model: 'qwen3:4b-instruct', text: 'safe', execution: { performed: false, reason: 'Phase 1 agents are advisory only.' } }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await routeFridayAgent('Check Proxmox')
    await askFridayAgent('agent/one', 'Check VM 100')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agents/route', expect.objectContaining({ method: 'POST', body: JSON.stringify({ prompt: 'Check Proxmox' }) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agents/agent%2Fone/ask', expect.objectContaining({ method: 'POST', body: JSON.stringify({ prompt: 'Check VM 100' }) }))
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