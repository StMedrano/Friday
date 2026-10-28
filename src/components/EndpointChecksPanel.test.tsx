import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EndpointChecksPanel from './EndpointChecksPanel'

afterEach(() => vi.unstubAllGlobals())

const nas = { id: 'nas', name: 'NAS', site: 'Home', url: 'http://10.0.0.5/', expectedStatuses: [200] }
const view = (checks: unknown[], managed = false) => ({ managed, enabled: true, limit: 16, checks })
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('EndpointChecksPanel', () => {
  it('creates a check with a JSON POST', async () => {
    const router = { id: 'router', name: 'Router', site: 'Home', url: 'http://10.0.0.1/', expectedStatuses: [200, 401] }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? reply({ ...view([nas, router], true), check: router }, 201)
      : reply(view([nas])))
    vi.stubGlobal('fetch', fetchMock)
    render(<EndpointChecksPanel />)

    const form = await screen.findByRole('form', { name: 'Add endpoint check' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Router' } })
    fireEvent.change(within(form).getByLabelText('Site'), { target: { value: 'Home' } })
    fireEvent.change(within(form).getByLabelText('URL'), { target: { value: 'http://10.0.0.1/' } })
    fireEvent.change(within(form).getByLabelText('Expected HTTP statuses'), { target: { value: '200, 401' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add check' }))

    expect(await screen.findByText(/Router added/)).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/settings/endpoints')
    expect(options?.method).toBe('POST')
    expect((options?.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(options?.body))).toEqual({ name: 'Router', site: 'Home', url: 'http://10.0.0.1/', expectedStatuses: [200, 401] })
    expect(within(screen.getByRole('list', { name: 'Endpoint checks' })).getByText('Router')).toBeInTheDocument()
  })

  it('edits and deletes a check', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') return reply({ ...view([{ ...nas, name: 'NAS web', expectedStatuses: null }], true), check: { ...nas, name: 'NAS web', expectedStatuses: null } })
      if (options?.method === 'DELETE') return reply(view([], true))
      return reply(view([nas]))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<EndpointChecksPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit NAS' }))
    const form = screen.getByRole('form', { name: 'Edit NAS' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'NAS web' } })
    fireEvent.change(within(form).getByLabelText('Expected HTTP statuses'), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save check' }))
    expect(await screen.findByText(/NAS web saved/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/settings/endpoints/nas')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ name: 'NAS web', site: 'Home', url: 'http://10.0.0.5/', expectedStatuses: null })

    fireEvent.click(screen.getByRole('button', { name: 'Delete NAS web' }))
    expect(await screen.findByText(/NAS web deleted/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[2][0]).toBe('/api/settings/endpoints/nas')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')
  })

  it('explains operator access and invalid input', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? reply({ error: 'access-denied' }, 403)
      : reply(view([]))))
    render(<EndpointChecksPanel />)
    const form = await screen.findByRole('form', { name: 'Add endpoint check' })
    fireEvent.change(within(form).getByLabelText('Expected HTTP statuses'), { target: { value: 'abc' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add check' }))
    expect(await screen.findByText(/Expected statuses are HTTP codes/)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Expected HTTP statuses'), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add check' }))
    expect(await screen.findByText('Operator access is required to change endpoint checks.')).toBeInTheDocument()
  })

  it('shows an unavailable message without controls when the API is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'endpoint-checks-unavailable' }, 503)))
    render(<EndpointChecksPanel />)
    expect(await screen.findByText(/Endpoint checks are unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
