import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiDesignerSessionsPanel from './AiDesignerSessionsPanel'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('AiDesignerSessionsPanel', () => {
  it('stays not connected with a setup link and sends no request when AIDesigner is off', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'aidesigner-unavailable' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    render(<AiDesignerSessionsPanel enabled={false}/>)
    expect(screen.getByRole('note', { name: 'Design sessions: not connected' })).toHaveTextContent('FRIDAY_AIDESIGNER_ENABLED')
    expect(screen.getByRole('link', { name: 'How to connect: AIDesigner design generation' }))
      .toHaveAttribute('href', expect.stringMatching(/integrations\.md#aidesigner-design-generation$/))
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says sessions could not be loaded when the server answers 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'aidesigner-unavailable' }, 503)))
    render(<AiDesignerSessionsPanel enabled/>)
    expect(await screen.findByText('Design sessions could not be loaded.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('asks for a Cloudflare Access sign-in when the server needs one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'aidesigner-authentication-required' }, 503)))
    render(<AiDesignerSessionsPanel enabled/>)
    expect(await screen.findByText(/sign in through Cloudflare Access/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessions: [] })))
    render(<AiDesignerSessionsPanel enabled/>)
    expect(await screen.findByText('No design sessions yet.')).toBeInTheDocument()
  })

  it('lists sessions with name, updated time and editor link, read only', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => json({ sessions: [
      { sessionId: '155feecb-0000-4000-8000-000000000001', title: 'Friday dashboard', editorUrl: 'https://www.aidesigner.ai/editor/155feecb', canvasCount: 3, publishedUrl: null, updatedAt: '2026-11-05T10:00:00.000Z' },
      { sessionId: '155feecb-0000-4000-8000-000000000002', title: 'Phone home', editorUrl: null, canvasCount: 1, publishedUrl: 'https://friday-phone.aidesigner.app/', updatedAt: null },
      { sessionId: '155feecb-0000-4000-8000-000000000003', title: 'Bad link', editorUrl: 'javascript:alert(1)', canvasCount: 0, publishedUrl: 'http://insecure.example/', updatedAt: 'not a date' },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AiDesignerSessionsPanel enabled/>)

    const panel = await screen.findByRole('region', { name: 'Design sessions' })
    const items = within(panel).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Friday dashboard')
    expect(items[0]).toHaveTextContent('3 canvases')
    expect(items[0]).toHaveTextContent(/Updated /)
    expect(within(items[0]).getByRole('link', { name: 'Open Friday dashboard in AIDesigner' }))
      .toHaveAttribute('href', 'https://www.aidesigner.ai/editor/155feecb')
    expect(items[1]).toHaveTextContent('1 canvas')
    expect(within(items[1]).queryByRole('link', { name: /in AIDesigner/ })).not.toBeInTheDocument()
    expect(within(items[1]).getByRole('link', { name: 'Published page for Phone home' }))
      .toHaveAttribute('href', 'https://friday-phone.aidesigner.app/')
    expect(within(items[2]).queryByRole('link')).not.toBeInTheDocument()
    expect(items[2]).not.toHaveTextContent('not a date')

    expect(within(panel).queryByRole('button')).not.toBeInTheDocument()
    expect(panel).toHaveTextContent(/Read only/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/aidesigner/sessions', expect.objectContaining({ method: 'GET' }))
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
  })

  it('treats a malformed list as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessions: 'nope' })))
    render(<AiDesignerSessionsPanel enabled/>)
    expect(await screen.findByText('Design sessions could not be loaded.')).toBeInTheDocument()
  })
})
