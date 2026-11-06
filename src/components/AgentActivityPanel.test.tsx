import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentActivityPanel from './AgentActivityPanel'

afterEach(() => vi.unstubAllGlobals())

describe('AgentActivityPanel', () => {
  it('lists recent agent questions with outcome and model, newest first', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ events: [
      { id: 'e2', at: '2026-11-05T10:05:00.000Z', agentId: 'homelab', agentName: 'HomeLab', outcome: 'unavailable', reason: 'grounding-invalid', durationMs: 900 },
      { id: 'e1', at: '2026-11-05T10:00:00.000Z', agentId: 'proxmox-observer', agentName: 'Proxmox Observer', outcome: 'answered', model: 'qwen3:4b', durationMs: 2400 },
    ] })))
    vi.stubGlobal('fetch', fetchMock)
    render(<AgentActivityPanel/>)
    const panel = await screen.findByRole('region', { name: 'Live agent events' })
    const items = within(panel).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('HomeLab')
    expect(items[0]).toHaveTextContent('Unavailable')
    expect(items[0]).toHaveTextContent('answer failed grounding check')
    expect(items[1]).toHaveTextContent('Proxmox Observer')
    expect(items[1]).toHaveTextContent('qwen3:4b · 2.4s')
    expect(panel).toHaveTextContent('Questions and answers are not stored.')
    expect(fetchMock).toHaveBeenCalledWith('/api/agents/activity', expect.objectContaining({ method: 'GET' }))
  })

  it('stays not connected when the log is off and says so when it cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agent-activity-disabled' }), { status: 503 })))
    const { unmount } = render(<AgentActivityPanel/>)
    expect(await screen.findByRole('note', { name: 'Live agent events: not connected' })).toBeInTheDocument()
    unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    render(<AgentActivityPanel/>)
    expect(await screen.findByText('Agent activity could not be loaded.')).toBeInTheDocument()
  })
})
