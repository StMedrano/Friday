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
})
