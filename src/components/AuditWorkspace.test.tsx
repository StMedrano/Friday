import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuditWorkspace from './AuditWorkspace'

afterEach(() => vi.unstubAllGlobals())

const event = (seq: number, phase: string, extra: Record<string, unknown> = {}) => ({
  seq, requestId: `00000000-0000-4000-8000-00000000000${seq}`, at: '2026-10-28T12:00:00.000Z',
  action: 'incidents.diagnostics.rerun', phase, actor: { kind: 'human', id: 'a'.repeat(64), label: 'owner@example.com' },
  target: 'incident-7', detail: null, prev: '0'.repeat(64), hash: 'b'.repeat(64), ...extra,
})
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('AuditWorkspace', () => {
  it('lists verified audit events read-only and pages older events', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => String(input).includes('before=2')
      ? reply({ integrity: 'verified', nextBefore: null, events: [event(1, 'requested', { action: 'agents.registry.sync', target: null })] })
      : reply({ integrity: 'verified', nextBefore: 2, events: [event(3, 'failed', { detail: 'incident-not-found' }), event(2, 'requested')] }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<AuditWorkspace />)

    expect(await screen.findByText(/Chain verified/)).toBeInTheDocument()
    expect(screen.getAllByText('Diagnostic rerun')).toHaveLength(2)
    expect(screen.getByText('incident-not-found')).toBeInTheDocument()
    expect(screen.getAllByText(/incident-7 · owner@example.com/)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Load older events' }))
    expect(await screen.findByText('Registry sync')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load older events' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
    expect(String(fetchMock.mock.calls[1][0])).toContain('before=2')
  })

  it('explains disabled, operator-only, broken and empty states', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'audit-not-enabled' }, 503)))
    const { rerender } = render(<AuditWorkspace />)
    expect(await screen.findByText(/Action audit is not enabled/)).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'access-denied' }, 403)))
    rerender(<AuditWorkspace key="denied" />)
    expect(await screen.findByText(/Operator access is required/)).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(async () => reply({ integrity: 'broken', nextBefore: null, events: [] })))
    rerender(<AuditWorkspace key="broken" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed integrity verification/)

    vi.stubGlobal('fetch', vi.fn(async () => reply({ integrity: 'verified', nextBefore: null, events: [] })))
    rerender(<AuditWorkspace key="empty" />)
    expect(await screen.findByText(/No audited actions yet/)).toBeInTheDocument()
  })
})
