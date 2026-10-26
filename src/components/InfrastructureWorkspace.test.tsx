import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InfrastructureWorkspace from './InfrastructureWorkspace'
import type { FridayOverview } from '../lib/api'

const site = (id: string, name: string) => ({
  id, name, location: name === 'Site A' ? 'Primary lab' : 'Remote lab',
  status: 'online' as const, gateway: 'Not evaluated', network: '',
  latencyMs: 0, vpn: 'online' as const, devicesOnline: 0, devicesTotal: 0,
})
const service = (id: string, name: string, host: string, siteName: string, status: 'online' | 'offline' | 'degraded' | 'maintenance') => ({
  id, name, host, site: siteName, status, category: 'monitoring' as const,
  detail: 'Read-only inventory', updated: '2026-10-26T18:00:00Z',
})
const overview: FridayOverview = {
  mode: 'live', generatedAt: '2026-10-26T18:00:00Z',
  sites: [site('a', 'Site A'), site('b', 'Site B')],
  services: [
    service('a-router', 'Core Router', 'edge-a', 'Site A', 'online'),
    service('a-dns', 'Primary DNS', 'edge-a', 'Site A', 'offline'),
    service('b-gateway', 'Remote Gateway', 'edge-b', 'Site B', 'degraded'),
    service('shared-proxy', 'Shared Proxy', 'shared-host', 'Both Sites', 'online'),
    service('unassigned', 'Unknown Owner', 'unknown-host', '', 'maintenance'),
  ],
  alerts: [], resources: [], activities: [],
}

describe('InfrastructureWorkspace site topology', () => {
  it('presents observed site/host grouping without inventing VPN links or executed controls', () => {
    render(<InfrastructureWorkspace overview={overview} connected />)
    const inventory = screen.getByRole('region', { name: 'Observed services' })
    expect(within(inventory).getByText('Core Router')).toBeInTheDocument()
    expect(within(inventory).getByText('Primary DNS')).toBeInTheDocument()
    expect(within(inventory).getByText('Remote Gateway')).toBeInTheDocument()
    expect(within(inventory).getByRole('heading', { name: 'edge-a' })).toBeInTheDocument()
    expect(screen.getByText(/not a verified network path/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|deploy|execute|stop service/i })).not.toBeInTheDocument()
  })

  it('filters by exact observed site, never duplicating ambiguous shared services', () => {
    render(<InfrastructureWorkspace overview={overview} connected />)
    fireEvent.click(screen.getByRole('button', { name: /site b/i }))
    const inventory = screen.getByRole('region', { name: 'Observed services' })
    expect(within(inventory).getByText('Remote Gateway')).toBeInTheDocument()
    expect(within(inventory).queryByText('Core Router')).not.toBeInTheDocument()
    expect(within(inventory).queryByText('Shared Proxy')).not.toBeInTheDocument()
    expect(within(inventory).queryByText('Unknown Owner')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /site b/i })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /shared.*multi-site/i }))
    expect(within(inventory).getByText('Shared Proxy')).toBeInTheDocument()
    expect(within(inventory).queryByText('Remote Gateway')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /all sites/i }))
    expect(within(inventory).getByText('Primary DNS')).toBeInTheDocument()
  })

  it('keeps unassigned services explicit and derives sites from service evidence when site metadata is absent', () => {
    render(<InfrastructureWorkspace overview={{ ...overview, sites: [] }} connected />)
    expect(screen.getByRole('button', { name: /site a/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /unassigned/i }))
    const inventory = screen.getByRole('region', { name: 'Observed services' })
    expect(within(inventory).getByText('Unknown Owner')).toBeInTheDocument()
    expect(within(inventory).queryByText('Shared Proxy')).not.toBeInTheDocument()
    expect(screen.queryByText(/vpn connected|tunnel healthy/i)).not.toBeInTheDocument()
  })

  it('shows missing live inventory as unavailable evidence, not a fabricated healthy site', () => {
    render(<InfrastructureWorkspace overview={{ ...overview, sites: [], services: [] }} connected />)
    expect(screen.getByText(/no site or service inventory available/i)).toBeInTheDocument()
    expect(screen.queryByText(/all systems healthy/i)).not.toBeInTheDocument()
  })

  it('labels fixture/offline data and restores all-sites when a selected site disappears', () => {
    const { rerender } = render(<InfrastructureWorkspace overview={{ ...overview, mode: 'mock' }} connected={false} />)
    expect(screen.getByText(/preview data.*not live/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /site b/i }))
    rerender(<InfrastructureWorkspace overview={{ ...overview, services: overview.services.filter(x => x.site === 'Site A'), sites: [overview.sites[0]] }} connected />)
    expect(screen.getByRole('button', { name: /all sites/i })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('region', { name: 'Observed services' })).getByText('Core Router')).toBeInTheDocument()
  })
})
