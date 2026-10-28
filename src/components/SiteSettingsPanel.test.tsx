import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SiteSettingsPanel from './SiteSettingsPanel'

afterEach(() => vi.unstubAllGlobals())

const view = (sites: Array<{ id: string; name: string }>, proxmox: string | null = null) => ({
  sites,
  sources: [
    { id: 'proxmox', name: 'Proxmox VE', site: proxmox, defaultSite: 'Site A', enabled: true },
    { id: 'docker', name: 'Local Docker (VM102)', site: null, defaultSite: 'Site A', enabled: false },
  ],
})

describe('SiteSettingsPanel', () => {
  it('declares a site, assigns a source and saves with a JSON PUT', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'PUT'
      ? new Response(JSON.stringify(view([{ id: 'home', name: 'Home' }], 'Home')), { status: 200 })
      : new Response(JSON.stringify(view([])), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SiteSettingsPanel />)

    fireEvent.change(await screen.findByLabelText('New site'), { target: { value: 'Home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }))
    fireEvent.change(screen.getByLabelText('Site for Proxmox VE'), { target: { value: 'Home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sites' }))

    expect(await screen.findByText(/Sites saved/)).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/settings/sites')
    expect(options?.method).toBe('PUT')
    expect((options?.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(options?.body))).toEqual({ sites: ['Home'], sources: { proxmox: 'Home', docker: null } })
    expect(within(screen.getByRole('list', { name: 'Declared sites' })).getByText('Home')).toBeInTheDocument()
  })

  it('explains when operator access is required', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'PUT'
      ? new Response(JSON.stringify({ error: 'access-denied' }), { status: 403 })
      : new Response(JSON.stringify(view([])), { status: 200 })))
    render(<SiteSettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save sites' }))
    expect(await screen.findByText('Operator access is required to change sites.')).toBeInTheDocument()
  })

  it('shows an unavailable message without controls when the API is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'site-settings-unavailable' }), { status: 503 })))
    render(<SiteSettingsPanel />)
    expect(await screen.findByText(/Site settings are unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
