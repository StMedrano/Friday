import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import IncidentsWorkspace from './IncidentsWorkspace'

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
  it('shows active, resolved, monitoring status, and recent history without remediation controls', () => {
    render(<IncidentsWorkspace incidents={[active, resolved]} monitoring={monitoring} history={history} />)

    expect(screen.getByRole('heading', { name: /active incidents/i })).toBeInTheDocument()
    expect(screen.getByText('nginx-proxy-manager')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
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
})
