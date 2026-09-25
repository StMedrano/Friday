import { afterEach, describe, expect, it, vi } from 'vitest'
import { askFridayAssistant } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('Friday assistant history request contract', () => {
  it('posts prompt and bounded history payload shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      mode: 'cloud-ai',
      provider: 'groq',
      model: 'test-model',
      text: 'ok',
      fallbackUsed: false,
      attempts: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await askFridayAssistant('Compare it to VM102', {
      history: [{ role: 'user', content: 'Check friday-ollama' }],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'Compare it to VM102',
      history: [{ role: 'user', content: 'Check friday-ollama' }],
    })
  })

  it('sends empty history when options are omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      mode: 'local-analysis',
      provider: 'deterministic',
      model: null,
      text: 'ok',
      fallbackUsed: true,
      attempts: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await askFridayAssistant('Check health')

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'Check health',
      history: [],
    })
  })

  it('preserves matched local-agent provenance on a 503 response', async () => {
    const failure = {
      available: false,
      mode: 'local-agent',
      provider: 'ollama',
      error: 'local-agent-unavailable',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      reason: 'Local agent inference unavailable.',
      routing: {
        matched: true,
        method: 'deterministic',
        confidence: 0.98,
        reason: 'Strong Proxmox scope match.',
      },
      execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(failure), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(askFridayAssistant('Inspect Proxmox')).rejects.toMatchObject({
      message: 'Local agent inference unavailable.',
      response: failure,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
