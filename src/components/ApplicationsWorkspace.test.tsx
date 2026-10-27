import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ApplicationsWorkspace from './ApplicationsWorkspace'
import type { FridayOverview } from '../lib/api'

const example: FridayOverview = {
  mode: 'live', generatedAt: '2026-10-27T13:40:00Z',
  sites: [], alerts: [], resources: [], activities: [],
  services: [
    { id: 'nextcloud', name: 'Nextcloud', category: 'app', host: 'vm110',
      site: 'Media', status: 'online', detail: 'Private cloud', updated: '2026-10-27T13:35:00Z' },
    { id: 'emby', name: 'Emby', category: 'media', host: 'vm110',
      site: 'Media', status: 'offline', detail: 'Streaming service', updated: '2026-10-27T13:30:00Z' },
    { id: 'infra-container', name: 'Homepage', category: 'container', host: 'vm100',
      site: 'Infrastructure', status: 'degraded', detail: 'Degraded container', updated: '' },
    { id: 'router', name: 'Core Router', category: 'network', host: 'router',
      site: 'Infrastructure', status: 'online', detail: 'Gateway', updated: '2026-10-27T13:34:00Z' },
  ],
}

describe('ApplicationsWorkspace observed, read-only application inventory', () => {
  it('shows only observed app/media/container services with exact status and source metadata', async () => {
    render(<ApplicationsWorkspace overview={example} connected />)
    const inventory = screen.getByRole('region', { name: 'Observed application services' })
    expect(within(inventory).getByText('Nextcloud')).toBeInTheDocument()
    expect(within(inventory).getByText('Emby')).toBeInTheDocument()
    expect(within(inventory).getByText('Homepage')).toBeInTheDocument()
    expect(within(inventory).queryByText('Core Router')).not.toBeInTheDocument()
    expect(screen.getByText(/not an installed-app catalog/i)).toBeInTheDocument()
    await userEvent.setup().click(within(inventory).getByRole('button', { name: /Emby/i }))
    expect(screen.getByText(/last observed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|deploy|launch|open app|remove/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /nextcloud|emby/i })).not.toBeInTheDocument()
  })

  it('filters case-insensitively by observed site/name/host, and distinguishes non-healthy services', async () => {
    const user = userEvent.setup()
    render(<ApplicationsWorkspace overview={example} connected />)
    const inventory = screen.getByRole('region', { name: 'Observed application services' })
    await user.click(screen.getByRole('button', { name: 'Attention' }))
    expect(within(inventory).queryByText('Nextcloud')).not.toBeInTheDocument()
    expect(within(inventory).getByText('Emby')).toBeInTheDocument()
    expect(within(inventory).getByText('Homepage')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search observed applications' }), 'VM100')
    expect(within(inventory).getByText('Homepage')).toBeInTheDocument()
    expect(within(inventory).queryByText('Emby')).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: 'Search observed applications' }))
    await user.click(screen.getByRole('button', { name: 'Online' }))
    expect(within(inventory).getByText('Nextcloud')).toBeInTheDocument()
    expect(within(inventory).queryByText('Homepage')).not.toBeInTheDocument()
  })

  it('never treats disconnected fixtures as verified live applications or invents services', () => {
    const { rerender } = render(<ApplicationsWorkspace overview={{ ...example, mode: 'mock' }} connected={false} />)
    expect(screen.getByText(/preview only.*not verified live/i)).toBeInTheDocument()
    rerender(<ApplicationsWorkspace overview={{ ...example, services: [] }} connected />)
    expect(screen.getByText(/no application-related services are present in the current inventory/i)).toBeInTheDocument()
    expect(screen.queryByText('Nextcloud')).not.toBeInTheDocument()
  })
})
