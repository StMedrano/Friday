import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApprovalsQueue from './ApprovalsQueue'

afterEach(() => vi.unstubAllGlobals())

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const pending = { id: 'i1', incidentId: 'i1', state: 'pending', title: 'Service offline', serviceName: 'plex', severity: 'high', detail: 'plex is offline on vm102', recommendedAction: 'Inspect service status', openedAt: '2026-11-05T18:00:00.000Z' }

describe('ApprovalsQueue', () => {
  it('shows pending proposals and records an approval without executing anything', async () => {
    let decided = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      if (String(input).endsWith('/decision')) {
        decided = true
        return reply({ approval: { ...pending, state: 'approved', decidedAt: '2026-11-05T19:00:00.000Z' }, execution: { performed: false } })
      }
      return reply(decided
        ? { pending: [], recent: [{ ...pending, state: 'approved', decidedAt: '2026-11-05T19:00:00.000Z', decidedBy: 'op@example.com', incidentStatus: 'open' }] }
        : { pending: [pending], recent: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<ApprovalsQueue/>)

    expect(await screen.findByText('1 pending')).toBeInTheDocument()
    expect(screen.getByText(/Proposed: Inspect service status/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve Service offline for plex' }))

    expect(await screen.findByText(/plex approved. Nothing was executed./)).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/decision'))!
    expect(url).toBe('/api/approvals/i1/decision')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({ decision: 'approve' })
    expect(await screen.findByText(/op@example.com/)).toBeInTheDocument()
    expect(screen.getByText('Nothing is waiting for approval.')).toBeInTheDocument()
  })

  it('explains operator access errors and the disabled state', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/decision')
      ? reply({ error: 'access-denied' }, 403)
      : reply({ pending: [pending], recent: [] })))
    const user = userEvent.setup()
    const { unmount } = render(<ApprovalsQueue compact/>)
    await user.click(await screen.findByRole('button', { name: 'Deny Service offline for plex' }))
    expect(await screen.findByText('Operator access is required to approve or deny.')).toBeInTheDocument()
    unmount()

    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'approvals-disabled' }, 503)))
    render(<ApprovalsQueue/>)
    expect(await screen.findByLabelText('Approvals: not connected')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How to connect: Approvals queue' })).toBeInTheDocument()
  })
})
