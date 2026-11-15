import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebGrowthDesigns, { leadPrompt } from './WebGrowthDesigns'

const SESSION = '155feecb-0000-4000-8000-000000000001'
const session = { sessionId: SESSION, title: 'Bakery homepage', editorUrl: 'https://www.aidesigner.ai/editor/155feecb', canvasCount: 2, publishedUrl: null, updatedAt: '2026-11-05T10:00:00.000Z' }
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

type Handler = (body: Record<string, unknown>) => Response | Promise<Response>
function stub(list: () => Response, generate: Handler = () => json({ sessionId: SESSION, editorUrl: session.editorUrl, replay: false })) {
  const posts: Record<string, unknown>[] = []
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (url === '/api/aidesigner/designs') {
      const body = JSON.parse(String(init?.body))
      posts.push(body)
      return generate(body)
    }
    return list()
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, posts }
}

async function fillAndConfirm(prompt = 'A homepage for a bakery') {
  fireEvent.change(await screen.findByLabelText('Describe the website design'), { target: { value: prompt } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate design…' }))
}

afterEach(() => vi.unstubAllGlobals())

describe('WebGrowthDesigns', () => {
  it('shows a setup link and sends nothing else when AIDesigner is switched off', async () => {
    const { fetchMock } = stub(() => json({ error: 'aidesigner-disabled' }, 503))
    render(<WebGrowthDesigns/>)
    expect(await screen.findByRole('note', { name: 'Website designs: not connected' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /How to connect/ })).toHaveAttribute('href', expect.stringMatching(/#aidesigner-design-generation$/))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lists design projects read only when generating is off', async () => {
    const { posts } = stub(() => json({ sessions: [session], generate: false }))
    render(<WebGrowthDesigns leadName="Fixture Bakery"/>)
    expect(await screen.findByText('Bakery homepage')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Bakery homepage in AIDesigner' })).toHaveAttribute('href', session.editorUrl)
    expect(screen.getByText(/Generating is off/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('never generates without the explicit credit confirmation, and cancel sends nothing', async () => {
    const { posts } = stub(() => json({ sessions: [], generate: true }))
    render(<WebGrowthDesigns/>)
    expect(await screen.findByRole('button', { name: 'Generate design…' })).toBeDisabled()
    await fillAndConfirm()
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm design generation' })
    expect(dialog).toHaveTextContent('This spends AIDesigner credits')
    expect(dialog).toHaveTextContent('A homepage for a bakery')
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(posts).toHaveLength(0)
  })

  it('generates after confirmation, links the result and refreshes the list', async () => {
    const { posts, fetchMock } = stub(() => json({ sessions: [session], generate: true }))
    render(<WebGrowthDesigns leadName="Fixture Bakery"/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Start from Fixture Bakery' }))
    expect(screen.getByLabelText('Describe the website design')).toHaveValue(leadPrompt('Fixture Bakery'))
    fireEvent.change(screen.getByLabelText('Screen'), { target: { value: 'mobile' } })
    fireEvent.change(screen.getByLabelText('Save to'), { target: { value: SESSION } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate design…' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('“Bakery homepage”')
    fireEvent.click(screen.getByRole('button', { name: 'Spend credits and generate' }))
    expect(await screen.findByRole('link', { name: /Open it in AIDesigner/ })).toHaveAttribute('href', session.editorUrl)
    expect(posts).toEqual([{ prompt: leadPrompt('Fixture Bakery'), viewport: 'mobile', sessionId: SESSION, idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/) }])
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/aidesigner/sessions')).toHaveLength(2))
  })

  it('a lost answer keeps the same idempotency key for the retry; editing the prompt starts a new one', async () => {
    let call = 0
    const { posts } = stub(() => json({ sessions: [], generate: true }), () => {
      call += 1
      return call === 1 ? new Response('<html>524</html>', { status: 524 }) : json({ sessionId: SESSION, editorUrl: null, replay: true })
    })
    render(<WebGrowthDesigns/>)
    await fillAndConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Spend credits and generate' }))
    expect(await screen.findByText(/Friday lost the answer/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Generate design…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Spend credits and generate' }))
    expect(await screen.findByText(/no new credit was used/)).toBeInTheDocument()
    expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey)

    await fillAndConfirm('A different page')
    fireEvent.click(screen.getByRole('button', { name: 'Spend credits and generate' }))
    await waitFor(() => expect(posts).toHaveLength(3))
    expect(posts[2].idempotencyKey).not.toBe(posts[0].idempotencyKey)
  })

  it.each([
    [{ error: 'access-denied' }, 403, /Only an operator/],
    [{ error: 'aidesigner-credits-exhausted' }, 402, /out of credits/],
    [{ error: 'aidesigner-rate-limited' }, 429, /Try again in 30 seconds/],
    [{ error: 'aidesigner-canvas-busy' }, 409, /already generating/],
  ])('explains a refused generation (%j)', async (body, status, text) => {
    stub(() => json({ sessions: [], generate: true }), () => json(body, status, { 'retry-after': '30' }))
    render(<WebGrowthDesigns/>)
    await fillAndConfirm()
    fireEvent.click(screen.getByRole('button', { name: 'Spend credits and generate' }))
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open it in AIDesigner/ })).not.toBeInTheDocument()
  })
})
