import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IncidentsWorkspace from './IncidentsWorkspace'

vi.mock('./IncidentDetail', () => ({
  default: ({ incident }: { incident: { serviceName?: string } }) => <div data-testid="incident-detail">Diagnosis for {incident.serviceName}</div>,
}))

const active = {
  id: 'npm-offline-1',
  type: 'service-offline',
  title: 'Service offline',
  detail: 'nginx-proxy-manager is offline on VM 100',
  severity: 'high' as const,
  status: 'open' as const,
  source: 'monitoring',
  host: 'VM 100',
  serviceId: 'vm100-observer-npm',
  serviceName: 'nginx-proxy-manager',
  firstSeen: '2026-08-19T23:00:00.000Z',
  lastSeen: '2026-08-19T23:05:01.000Z',
  openedAt: '2026-08-19T23:05:01.000Z',
  resolvedAt: null,
  recommendedAction: 'Inspect service status; any restart requires approval before execution.',
  evidence: ['Exited (255)'],
}

const resolved = {
  ...active,
  id: 'npm-offline-old',
  status: 'resolved' as const,
  openedAt: '2026-08-19T20:00:00.000Z',
  resolvedAt: '2026-08-19T20:10:00.000Z',
}

const monitoring = {
  enabled: true,
  status: 'ok' as const,
  lastPollAt: '2026-08-19T23:05:01.000Z',
  lastSuccessAt: '2026-08-19T23:05:01.000Z',
  lastError: null,
  activeIncidents: 1,
  openHigh: 1,
  openWarning: 0,
}

const history = [{
  id: 'history-1',
  type: 'incident-opened',
  at: '2026-08-19T23:05:01.000Z',
  source: 'monitoring',
  host: 'VM 100',
  serviceId: 'vm100-observer-npm',
  serviceName: 'nginx-proxy-manager',
  detail: 'HIGH Service offline',
}]

describe('IncidentsWorkspace', () => {
  it('shows a pending read instead of zero or empty history',()=>{
    render(<IncidentsWorkspace incidents={[]} history={[]} historyLoading/>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading monitoring history')
    expect(screen.queryByText('0 recent events')).not.toBeInTheDocument()
    expect(screen.queryByText('No monitoring history is available yet.')).not.toBeInTheDocument()
  })
  it('does not label an unavailable history read as zero recent events',()=>{
    render(<IncidentsWorkspace incidents={[]} history={[]} historyError="Monitoring history unavailable"/>)
    expect(screen.queryByText('0 recent events')).not.toBeInTheDocument()
    expect(screen.queryByText(/operating within policy/i)).not.toBeInTheDocument()
    expect(screen.getByText('Monitoring UNAVAILABLE')).toBeInTheDocument()
  })
  it('shows active, resolved, monitoring status, and recent history without remediation controls', () => {
    render(<IncidentsWorkspace incidents={[active, resolved]} monitoring={monitoring} history={history} />)

    expect(screen.getByRole('heading', { name: /active incidents/i })).toBeInTheDocument()
    expect(screen.getAllByText('nginx-proxy-manager').length).toBeGreaterThan(0)
    expect(screen.getAllByText('HIGH').length).toBeGreaterThan(0)
    expect(screen.getByText(/monitoring ok/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /recently resolved/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /health history/i })).toBeInTheDocument()
    expect(screen.getByText('HIGH Service offline')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|stop|start|execute|repair/i })).not.toBeInTheDocument()
  })

  it('keeps incidents visible when history is unavailable', () => {
    render(<IncidentsWorkspace incidents={[active]} monitoring={{ ...monitoring, status: 'degraded' }} history={[]} historyError="History unavailable" />)
    expect(screen.getByText('nginx-proxy-manager')).toBeInTheDocument()
    expect(screen.getByText(/monitoring degraded/i)).toBeInTheDocument()
    expect(screen.getByText(/history unavailable/i)).toBeInTheDocument()
  })

  it('shows selected incident detail before recovery and history sections', () => {
    render(<IncidentsWorkspace
      incidents={[active, resolved]}
      monitoring={monitoring}
      history={history}
      selectedIncident={active}
      onSelectIncident={() => {}}
      onClearSelection={() => {}}
    />)

    const detail = screen.getByTestId('incident-detail')
    const recoveryHeading = screen.getByRole('heading', { name: /recently resolved/i })
    expect(detail).toHaveTextContent(/diagnosis for nginx-proxy-manager/i)
    expect(detail.compareDocumentPosition(recoveryHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /back to incidents/i })).toBeInTheDocument()
  })
})


describe('Read-only incident site and severity filters', () => {
  const remote = {
    ...active, id: 'remote-gateway-degraded', serviceId: 'remote-gateway',
    serviceName: 'Remote Gateway', host: 'remote-host', severity: 'warning' as const,
    detail: 'Gateway degraded', recommendedAction: 'Inspect route evidence only.',
  }
  const unknown = {
    ...active, id: 'unknown-remote', serviceId: 'no-match',
    serviceName: 'Unknown Remote', host: 'Site B router',
    severity: 'info' as const, detail: 'Unattributed event',
  }
  const services = [
    { id: 'vm100-observer-npm', name: 'nginx-proxy-manager', host: 'VM 100', site: 'Site A', status: 'offline' as const, category: 'container' as const, detail: '', updated: '' },
    { id: 'remote-gateway', name: 'Remote Gateway', host: 'remote-host', site: 'Site B', status: 'degraded' as const, category: 'network' as const, detail: '', updated: '' },
  ]

  it('filters incident cards by exact service/site attribution and severity', () => {
    render(<IncidentsWorkspace incidents={[active, remote, unknown]} services={services} history={history} monitoring={monitoring}/>)
    const bySite = screen.getByRole('group', { name: 'Filter incidents by site' })
    fireEvent.click(within(bySite).getByRole('button', { name: /site b/i }))
    const cards = screen.getByRole('region', { name: 'Filtered incidents' })
    expect(within(cards).getByText('Remote Gateway')).toBeInTheDocument()
    expect(within(cards).queryByText('nginx-proxy-manager')).not.toBeInTheDocument()
    expect(within(cards).queryByText('Unknown Remote')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'High severity' }))
    expect(screen.getByText('No incidents match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Warning severity' }))
    expect(within(cards).getByText('Remote Gateway')).toBeInTheDocument()
    expect(screen.getByText(/health history.*unfiltered/i)).toBeInTheDocument()
  })

  it('preserves unattributed incidents when matching service evidence is absent', () => {
    render(<IncidentsWorkspace incidents={[unknown]} services={services} history={[]}/>)
    fireEvent.click(within(screen.getByRole('group', { name: 'Filter incidents by site' }))
      .getByRole('button', { name: /unassigned/i }))
    expect(within(screen.getByRole('region', { name: 'Filtered incidents' })).getByText('Unknown Remote')).toBeInTheDocument()
    expect(screen.queryByText(/verified.*site b/i)).not.toBeInTheDocument()
  })
})
