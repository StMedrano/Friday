import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomelabActionsPanel from './HomelabActionsPanel'

afterEach(() => vi.unstubAllGlobals())

const listed = (mode = 'dry-run', recent: unknown[] = []) => ({
  mode, recent, execution: { performed: false },
  actions: [{ id: 'development', name: 'development', guestType: 'qemu', vmid: 140, node: 'home', operations: ['start', 'shutdown', 'reboot'], status: 'running' }],
})
const preview = (mode = 'dry-run') => ({ preview: {
  planId: '6f1d3f7e-8a4b-4c55-9e0a-0d1c2b3a4f5e', actionId: 'development', name: 'development', operation: 'reboot', mode,
  currentStatus: 'running', allowed: true, summary: 'VM 140 development is running. Approving will ask it to reboot cleanly.',
  confirmText: 'development', expiresAt: '2026-11-15T20:05:00Z',
}, execution: { performed: false } })

function stub(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    const path = String(input)
    const route = routes[path]
    if (!route) throw new Error('unexpected ' + path)
    return route()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('HomelabActionsPanel', () => {
  it('shows Not connected with its setup link when homelab changes are off', async () => {
    stub({ '/api/homelab/actions': () => new Response(JSON.stringify({ error: 'homelab-actions-disabled' }), { status: 503 }) })
    render(<HomelabActionsPanel/>)
    const note = await screen.findByRole('note', { name: 'Homelab changes: not connected' })
    expect(within(note).getByRole('link', { name: 'How to connect: Homelab changes' })).toBeInTheDocument()
  })

  it('previews first, then approves only after the guest name is typed', async () => {
    const fetchMock = stub({
      '/api/homelab/actions': () => new Response(JSON.stringify(listed()), { status: 200 }),
      '/api/homelab/actions/preview': () => new Response(JSON.stringify(preview()), { status: 200 }),
      '/api/homelab/actions/run': () => new Response(JSON.stringify({ run: { actionId: 'development', name: 'development', operation: 'reboot', mode: 'dry-run', state: 'dry-run', at: '2026-11-15T20:01:00Z' }, execution: { performed: false } }), { status: 200 }),
    })
    render(<HomelabActionsPanel/>)
    expect(await screen.findByText(/approving records what would happen and changes nothing/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview reboot development' }))
    const region = await screen.findByRole('region', { name: 'Change preview' })
    expect(within(region).getByText(/VM 140 development is running/)).toBeInTheDocument()
    const approve = within(region).getByRole('button', { name: 'Approve dry run' })
    expect(approve).toBeDisabled()
    fireEvent.change(within(region).getByLabelText(/to approve/), { target: { value: 'development' } })
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    expect(await screen.findByText('Reboot development: dry run recorded. Nothing was changed.')).toBeInTheDocument()
    const run = fetchMock.mock.calls.find(([path]) => String(path) === '/api/homelab/actions/run')!
    expect(JSON.parse(String(run[1]?.body))).toEqual({ planId: '6f1d3f7e-8a4b-4c55-9e0a-0d1c2b3a4f5e', confirm: 'development' })
  })

  it('explains a closed automation gate in live mode', async () => {
    stub({
      '/api/homelab/actions': () => new Response(JSON.stringify(listed('execute')), { status: 200 }),
      '/api/homelab/actions/preview': () => new Response(JSON.stringify(preview('execute')), { status: 200 }),
      '/api/homelab/actions/run': () => new Response(JSON.stringify({ error: 'automation-gate-closed' }), { status: 423 }),
    })
    render(<HomelabActionsPanel/>)
    expect(await screen.findByText(/HOMELAB CHANGES · LIVE/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview reboot development' }))
    const region = await screen.findByRole('region', { name: 'Change preview' })
    fireEvent.change(within(region).getByLabelText(/to approve/), { target: { value: 'development' } })
    fireEvent.click(within(region).getByRole('button', { name: 'Approve and reboot' }))
    expect(await screen.findByText(/automation gate on the Friday host is not armed/)).toBeInTheDocument()
  })
})
