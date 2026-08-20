import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MobileHome from './MobileHome'
import type { FridayOverview } from '../lib/api'

const overview: FridayOverview = {
  mode: 'live',
  sites: [{
    id: 'site-a', name: 'Home', location: 'Primary', status: 'online', gateway: '192.168.1.254', network: '192.168.1.0/24',
    latencyMs: 2, vpn: 'online', devicesOnline: 3, devicesTotal: 3,
  }],
  services: [
    { id: 'svc-online-1', name: 'Proxmox VE', category: 'virtualization', host: 'Proxmox', site: 'site-a', status: 'online', detail: 'Host reachable', updated: 'now' },
    { id: 'vm100-observer-npm', name: 'nginx-proxy-manager', category: 'container', host: 'VM 100', site: 'site-a', status: 'offline', detail: 'Exited (255)', updated: '2 days ago' },
    { id: 'svc-degraded', name: 'AdGuard Home', category: 'dns', host: 'VM 100', site: 'site-a', status: 'degraded', detail: 'Health check degraded', updated: '1 min ago' },
    { id: 'svc-online-2', name: 'FRIDAY Controller', category: 'app', host: 'VM 102', site: 'site-a', status: 'online', detail: 'API healthy', updated: 'now' },
    { id: 'svc-online-3', name: 'Omada Controller', category: 'network', host: 'VM 100', site: 'site-a', status: 'online', detail: 'Controller healthy', updated: 'now' },
    { id: 'svc-online-4', name: 'Uptime Kuma', category: 'monitoring', host: 'VM 100', site: 'site-a', status: 'online', detail: 'Monitoring healthy', updated: 'now' },
  ],
  alerts: [],
  resources: [],
  activities: [],
  incidents: [{
    id: 'i1', type: 'service-offline', title: 'Service offline', detail: 'nginx-proxy-manager is offline on VM 100',
    severity: 'high', status: 'open', source: 'monitoring', host: 'VM 100', serviceId: 'vm100-observer-npm', serviceName: 'nginx-proxy-manager',
    firstSeen: '2026-08-20T00:36:57.293Z', lastSeen: '2026-08-20T00:41:57.541Z', openedAt: '2026-08-20T00:41:57.541Z', resolvedAt: null,
    recommendedAction: 'Inspect approved diagnostics before any remediation.', evidence: ['Exited (255)'],
  }],
  monitoring: {
    enabled: true, status: 'ok', lastPollAt: '2026-08-20T00:42:00.000Z', lastSuccessAt: '2026-08-20T00:42:00.000Z', lastError: null,
    activeIncidents: 1, openHigh: 1, openWarning: 0,
  },
}

const baseProps = {
  connected: true,
  query: '',
  reply: 'FRIDAY is ready.',
  onQueryChange: vi.fn(),
  onSubmit: vi.fn(),
  onNavigate: vi.fn(),
  onSelectIncident: vi.fn(),
}

describe('MobileHome', () => {
  it('puts operational attention before health and the FRIDAY command surface', () => {
    render(<MobileHome overview={overview} {...baseProps}/>)

    const sections = screen.getByTestId('mobile-home').children
    expect(sections[0]).toHaveAttribute('data-mobile-section', 'attention')
    expect(sections[1]).toHaveAttribute('data-mobile-section', 'health')
    expect(sections[2]).toHaveAttribute('data-mobile-section', 'friday')
    expect(sections[3]).toHaveAttribute('data-mobile-section', 'infrastructure')
    expect(sections[4]).toHaveAttribute('data-mobile-section', 'services')

    expect(screen.getByRole('heading', { level: 1, name: 'nginx-proxy-manager' })).toBeInTheDocument()
    expect(screen.getByText(/1 HIGH INCIDENT/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view diagnosis/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /ask friday/i })).toBeInTheDocument()
  })

  it('selects the highest-priority incident from the attention card', async () => {
    const onSelectIncident = vi.fn()
    const user = userEvent.setup()
    render(<MobileHome overview={overview} {...baseProps} onSelectIncident={onSelectIncident}/>)
    await user.click(screen.getByRole('button', { name: /view diagnosis/i }))
    expect(onSelectIncident).toHaveBeenCalledWith(overview.incidents?.[0])
  })

  it('shows System nominal instead of an empty incident shell when nothing is open', () => {
    render(<MobileHome overview={{ ...overview, incidents: [], monitoring: { ...overview.monitoring!, activeIncidents: 0, openHigh: 0 } }} {...baseProps}/>)
    expect(screen.getByText(/system nominal/i)).toBeInTheDocument()
    expect(screen.queryByText(/high incident/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /view diagnosis/i })).not.toBeInTheDocument()
  })

  it('prioritizes offline then degraded services and limits the preview to five', async () => {
    const onNavigate = vi.fn()
    const user = userEvent.setup()
    render(<MobileHome overview={overview} {...baseProps} onNavigate={onNavigate}/>)

    const serviceSection = screen.getByTestId('mobile-service-preview')
    const rows = within(serviceSection).getAllByTestId('mobile-service-row')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('nginx-proxy-manager')
    expect(rows[0]).toHaveTextContent(/offline/i)
    expect(rows[1]).toHaveTextContent('AdGuard Home')
    expect(rows[1]).toHaveTextContent(/degraded/i)

    await user.click(within(serviceSection).getByRole('button', { name: /view all services/i }))
    expect(onNavigate).toHaveBeenCalledWith('Applications')
  })

  it('renders compact health metrics from normalized overview data only', () => {
    render(<MobileHome overview={overview} {...baseProps}/>)
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('4/6')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('1 site')).toBeInTheDocument()
    expect(screen.getByText(/API connected · live mode/i)).toBeInTheDocument()
  })
})
