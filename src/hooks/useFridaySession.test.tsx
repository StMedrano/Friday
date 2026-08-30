import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askFridayAgent, askFridayAssistant, routeFridayAgent } from '../lib/api'
import { useFridaySession, type FridaySession } from './useFridaySession'

vi.mock('../lib/api', () => ({
  askFridayAssistant: vi.fn(),
  routeFridayAgent: vi.fn(),
  askFridayAgent: vi.fn(),
}))

const mockAskFridayAssistant = vi.mocked(askFridayAssistant)
const mockRouteFridayAgent = vi.mocked(routeFridayAgent)
const mockAskFridayAgent = vi.mocked(askFridayAgent)
let latestSession: FridaySession | null = null

function Harness() {
  latestSession = useFridaySession()
  return null
}

function session() {
  if (!latestSession) throw new Error('session not rendered')
  return latestSession
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mockRouteFridayAgent.mockResolvedValue({
    matched: false,
    routing: 'none',
    confidence: 0,
    reason: 'No registered agent matched.',
  })
})

afterEach(() => {
  latestSession = null
  mockAskFridayAssistant.mockReset()
  mockRouteFridayAgent.mockReset()
  mockAskFridayAgent.mockReset()
})

describe('useFridaySession', () => {
  it('routes a matched request to the local agent and records local provenance without general assistant fallback', async () => {
    mockRouteFridayAgent.mockResolvedValueOnce({
      matched: true,
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      routing: 'deterministic',
      confidence: 0.98,
      reason: 'Strong Proxmox scope match.',
    })
    mockAskFridayAgent.mockResolvedValueOnce({
      available: true,
      mode: 'local-agent',
      provider: 'ollama',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      modelProfile: 'local-general',
      model: 'qwen3:4b-instruct',
      text: 'VM 100 is observed as online.',
      execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
    })
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('Check VM 100 on Proxmox')
    })

    expect(mockRouteFridayAgent).toHaveBeenCalledWith('Check VM 100 on Proxmox')
    expect(mockAskFridayAgent).toHaveBeenCalledWith('proxmox-observer', 'Check VM 100 on Proxmox')
    expect(mockAskFridayAssistant).not.toHaveBeenCalled()
    expect(session().messages[1]).toMatchObject({
      role: 'assistant',
      status: 'complete',
      mode: 'local-agent',
      provider: 'ollama',
      model: 'qwen3:4b-instruct',
      modelProfile: 'local-general',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      routing: 'deterministic',
      text: 'VM 100 is observed as online.',
    })
  })

  it('uses the existing general assistant unchanged after a safe agent no-match', async () => {
    mockAskFridayAssistant.mockResolvedValueOnce({
      available: true,
      mode: 'cloud-ai',
      provider: 'groq',
      model: 'general-model',
      text: 'General answer',
    })
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('Explain this dashboard')
    })

    expect(mockAskFridayAgent).not.toHaveBeenCalled()
    expect(mockAskFridayAssistant).toHaveBeenCalledWith('Explain this dashboard', { history: [] })
  })

  it('keeps registry or routing failure non-fatal by continuing to the general assistant', async () => {
    mockRouteFridayAgent.mockRejectedValueOnce(new Error('agent routing unavailable'))
    mockAskFridayAssistant.mockResolvedValueOnce({
      available: true,
      mode: 'local-analysis',
      provider: 'deterministic',
      model: null,
      text: 'General path still works',
    })
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('Show overall service status')
    })

    expect(mockAskFridayAssistant).toHaveBeenCalledTimes(1)
    expect(session().messages[1]).toMatchObject({ status: 'complete', text: 'General path still works' })
  })

  it('does not cloud-fallback a matched request when local agent inference fails', async () => {
    mockRouteFridayAgent.mockResolvedValueOnce({
      matched: true,
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      routing: 'local-router',
      confidence: 0.72,
      reason: 'Local router selected registered agent.',
    })
    mockAskFridayAgent.mockRejectedValueOnce(new Error('Local agent inference unavailable'))
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('Inspect the Proxmox guest state')
    })

    expect(mockAskFridayAssistant).not.toHaveBeenCalled()
    expect(session().messages[1]).toMatchObject({
      role: 'assistant',
      status: 'error',
      text: 'Local agent inference unavailable',
      agentId: 'proxmox-observer',
      agentName: 'Proxmox Observer',
      routing: 'local-router',
    })
  })

  it('appends an immediate user turn and loading placeholder then completes with provenance', async () => {
    const pending = deferred<Awaited<ReturnType<typeof askFridayAssistant>>>()
    mockAskFridayAssistant.mockReturnValueOnce(pending.promise)
    render(<Harness />)

    let send!: Promise<void>
    act(() => {
      send = session().sendMessage('Check service health')
    })

    expect(session().loading).toBe(true)
    expect(session().messages).toHaveLength(2)
    expect(session().messages[0]).toMatchObject({ role: 'user', text: 'Check service health', status: 'complete' })
    expect(session().messages[1]).toMatchObject({ role: 'assistant', status: 'loading' })

    await act(async () => {
      pending.resolve({
        available: true,
        mode: 'cloud-ai',
        provider: 'groq',
        model: 'llama-test',
        text: 'All observed services are healthy.',
        fallbackUsed: true,
        attempts: [{ provider: 'gemini', outcome: 'network' }],
      })
      await send
    })

    expect(session().loading).toBe(false)
    expect(session().messages[1]).toMatchObject({
      role: 'assistant',
      text: 'All observed services are healthy.',
      status: 'complete',
      mode: 'cloud-ai',
      provider: 'groq',
      model: 'llama-test',
      fallbackUsed: true,
      attempts: [{ provider: 'gemini', outcome: 'network' }],
    })
  })

  it('keeps the submitted user turn and marks the assistant placeholder as error without retrying', async () => {
    mockAskFridayAssistant.mockRejectedValueOnce(new Error('Friday assistant unavailable'))
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('Check health')
    })

    expect(mockAskFridayAssistant).toHaveBeenCalledTimes(1)
    expect(session().messages[0]).toMatchObject({ role: 'user', text: 'Check health', status: 'complete' })
    expect(session().messages[1]).toMatchObject({ role: 'assistant', text: 'Friday assistant unavailable', status: 'error' })
  })

  it('sends only the newest ten completed exchanges as history and never duplicates the current prompt', async () => {
    mockAskFridayAssistant.mockImplementation(async (prompt) => ({
      available: true,
      mode: 'cloud-ai',
      provider: 'groq',
      model: 'test-model',
      text: `answer ${prompt}`,
      fallbackUsed: false,
      attempts: [],
    }))
    render(<Harness />)

    for (let index = 0; index < 11; index += 1) {
      await act(async () => {
        await session().sendMessage(`question ${index}`)
      })
    }

    await act(async () => {
      await session().sendMessage('question 11')
    })

    const [, options] = mockAskFridayAssistant.mock.calls.at(-1)!
    expect(options?.history).toHaveLength(20)
    expect(options?.history?.[0]).toEqual({ role: 'user', content: 'question 1' })
    expect(options?.history?.at(-1)).toEqual({ role: 'assistant', content: 'answer question 10' })
    expect(options?.history?.some((message) => message.content === 'question 11')).toBe(false)
  })

  it('excludes failed exchanges and loading placeholders from later history', async () => {
    mockAskFridayAssistant.mockRejectedValueOnce(new Error('failed exchange'))
    render(<Harness />)

    await act(async () => {
      await session().sendMessage('failed question')
    })

    const pending = deferred<Awaited<ReturnType<typeof askFridayAssistant>>>()
    mockAskFridayAssistant.mockReturnValueOnce(pending.promise)
    let send!: Promise<void>
    act(() => {
      send = session().sendMessage('current question')
    })

    const [, options] = mockAskFridayAssistant.mock.calls.at(-1)!
    expect(options?.history).toEqual([])
    expect(session().messages.at(-1)?.status).toBe('loading')

    await act(async () => {
      pending.resolve({ available: true, mode: 'local-analysis', provider: 'deterministic', model: null, text: 'done' })
      await send
    })
  })

  it('clears only while idle and remounts with a fresh empty session', async () => {
    mockAskFridayAssistant.mockResolvedValue({ available: true, mode: 'local-analysis', provider: 'deterministic', model: null, text: 'done' })
    const view = render(<Harness />)

    await act(async () => {
      await session().sendMessage('first')
    })
    expect(session().messages).toHaveLength(2)

    act(() => session().clearSession())
    expect(session().messages).toEqual([])

    const pending = deferred<Awaited<ReturnType<typeof askFridayAssistant>>>()
    mockAskFridayAssistant.mockReturnValueOnce(pending.promise)
    let send!: Promise<void>
    act(() => {
      send = session().sendMessage('second')
    })
    act(() => session().clearSession())
    expect(session().messages).toHaveLength(2)

    await act(async () => {
      pending.resolve({ available: true, mode: 'local-analysis', provider: 'deterministic', model: null, text: 'done again' })
      await send
    })

    view.unmount()
    latestSession = null
    render(<Harness />)
    expect(session().messages).toEqual([])
  })
})
