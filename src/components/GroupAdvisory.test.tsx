import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupAdvisory from './GroupAdvisory'

afterEach(() => vi.unstubAllGlobals())

const advice = {
  available: true, groupId: 'app-builder', text: 'Requirements, then architecture.',
  mode: 'cloud-ai', provider: 'groq', model: 'llama', fallbackUsed: false, attempts: [],
  execution: { performed: false, reason: 'Friday group assistance is advisory only.' },
}

describe('GroupAdvisory', () => {
  it('sends the brief to the group advisory endpoint and shows the proposal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => new Response(JSON.stringify(advice), { status: 200, headers: { 'x-sent': String(options?.method ?? '') } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<GroupAdvisory groupId="app-builder" groupName="App Builder"/>)

    fireEvent.change(screen.getByLabelText('Describe the task'), { target: { value: 'Plan a booking app.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }))

    expect(await screen.findByText('Requirements, then architecture.')).toBeInTheDocument()
    expect(screen.getByText(/nothing was executed/)).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/group-advisory')
    expect(options?.method).toBe('POST')
    expect(JSON.parse(String(options?.body))).toEqual({ groupId: 'app-builder', prompt: 'Plan a booking app.' })
  })

  it('reports an unavailable provider instead of inventing a plan', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      available: false, reason: 'Group advice requires an available AI provider. No plan was generated.',
      execution: { performed: false },
    }), { status: 503 })))
    render(<GroupAdvisory groupId="homelab" groupName="HomeLab"/>)
    fireEvent.change(screen.getByLabelText('Describe the task'), { target: { value: 'Summarize issues.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate proposal' }))
    expect(await screen.findByText(/requires an available AI provider/)).toBeInTheDocument()
  })

  it('does not submit an empty brief', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<GroupAdvisory groupId="techtactics" groupName="TechTactics"/>)
    expect(screen.getByRole('button', { name: 'Generate proposal' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Use example' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate proposal' })).toBeEnabled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
