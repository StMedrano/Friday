import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RepositorySettingsPanel from './RepositorySettingsPanel'

afterEach(() => vi.unstubAllGlobals())

const friday = { id: 'friday', name: 'Friday', path: '/repositories/friday', defaultBranch: 'main', mode: 'development', enabled: true, exclude: ['data/**'] }
const view = (repositories: unknown[], managed = false) => ({ managed, allowedRoots: ['/repositories'], limit: 32, repositories })
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('RepositorySettingsPanel', () => {
  it('adds a repository with a JSON POST', async () => {
    const docs = { id: 'docs', name: 'Docs', path: '/repositories/docs', remote: 'https://github.com/o/docs.git', defaultBranch: 'trunk', mode: 'read-only', enabled: true, exclude: ['drafts/**', 'tmp'] }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? reply({ ...view([friday, docs], true), repository: docs }, 201)
      : reply(view([friday])))
    vi.stubGlobal('fetch', fetchMock)
    render(<RepositorySettingsPanel />)

    const form = await screen.findByRole('form', { name: 'Add repository' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Docs' } })
    fireEvent.change(within(form).getByLabelText('Checkout path'), { target: { value: '/repositories/docs' } })
    fireEvent.change(within(form).getByLabelText('Remote URL'), { target: { value: 'https://github.com/o/docs.git' } })
    fireEvent.change(within(form).getByLabelText('Default branch'), { target: { value: 'trunk' } })
    fireEvent.change(within(form).getByLabelText('Excluded paths'), { target: { value: 'drafts/**, tmp' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add repository' }))

    expect(await screen.findByText(/Docs added/)).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/settings/repositories')
    expect(options?.method).toBe('POST')
    expect((options?.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(options?.body))).toEqual({ name: 'Docs', path: '/repositories/docs', remote: 'https://github.com/o/docs.git', defaultBranch: 'trunk', enabled: true, exclude: ['drafts/**', 'tmp'] })
    expect(within(screen.getByRole('list', { name: 'Repositories' })).getByText('Docs')).toBeInTheDocument()
  })

  it('edits, disables and removes a repository', async () => {
    const edited = { ...friday, name: 'Friday UI', enabled: false }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') return reply({ ...view([edited], true), repository: edited })
      if (options?.method === 'DELETE') return reply(view([], true))
      return reply(view([friday]))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<RepositorySettingsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Friday' }))
    const form = screen.getByRole('form', { name: 'Edit Friday' })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Friday UI' } })
    fireEvent.click(within(form).getByLabelText('Enabled'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save repository' }))
    expect(await screen.findByText(/Friday UI saved/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[1][0]).toBe('/api/settings/repositories/friday')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ name: 'Friday UI', path: '/repositories/friday', defaultBranch: 'main', enabled: false, exclude: ['data/**'] })
    expect(screen.getByText(/Disabled/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Friday UI' }))
    expect(await screen.findByText(/Friday UI removed/)).toBeInTheDocument()
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')
  })

  it('explains operator access and path errors', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method !== 'POST') return reply(view([]))
      calls += 1
      return calls === 1 ? reply({ error: 'repository-path-not-allowed' }, 400) : reply({ error: 'access-denied' }, 403)
    }))
    render(<RepositorySettingsPanel />)
    const form = await screen.findByRole('form', { name: 'Add repository' })
    fireEvent.click(within(form).getByRole('button', { name: 'Add repository' }))
    expect(await screen.findByText(/must be a checkout inside \/repositories/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Add repository' }))
    expect(await screen.findByText('Operator access is required to change repositories.')).toBeInTheDocument()
  })

  it('shows an unavailable message without controls when the API is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'repository-settings-unavailable' }, 503)))
    render(<RepositorySettingsPanel />)
    expect(await screen.findByText(/Repository settings are unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
