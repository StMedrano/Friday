import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ActiveIncidents from './ActiveIncidents'

const incident = {
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

describe('ActiveIncidents', () => {
  it('renders prioritized read-only incident context without execution controls', () => {
    render(<ActiveIncidents incidents={[incident]} />)

    expect(screen.getByText('nginx-proxy-manager')).toBeInTheDocument()
    expect(screen.getByText('VM 100')).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
    expect(screen.getByText('READ ONLY')).toBeInTheDocument()
    expect(screen.getByText('REQUIRES APPROVAL TO ACT')).toBeInTheDocument()
    expect(screen.getByText(/any restart requires approval/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|stop|start|execute|repair/i })).not.toBeInTheDocument()
  })

  it('renders a safe empty state when monitoring data is absent', () => {
    render(<ActiveIncidents incidents={[]} />)
    expect(screen.getByText(/no active incidents/i)).toBeInTheDocument()
  })
})
