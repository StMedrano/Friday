import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const liveService = { id: 'cloud', name: 'Cloud Portal', category: 'app', host: 'vm100',
  site: 'Infrastructure', status: 'online', detail: 'Observed web service', updated: '2026-10-27T12:00:00Z' }

vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({ connected: true, overview: {
    mode: 'live', sites: [], services: [liveService], alerts: [], resources: [],
    activities: [], incidents: [], monitoring: null,
  } }),
  fetchMonitoringHistory: vi.fn(async () => []),
  askFridayAssistant: vi.fn(async () => ({ available: false, execution: { performed: false } })),
}))
vi.mock('../hooks/usePhoneLayout', () => ({ usePhoneLayout: () => false }))
vi.mock('../components/AgentsWorkspace', () => ({
  default: () => <div>Agent registry view</div>,
}))
vi.mock('../components/RepositoriesWorkspace', () => ({
  default: () => <div>Repository view</div>,
}))

import Dashboard from './Dashboard'

describe('Dashboard operator integrity and honest feature status', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does not pretend automation is enabled or that two approval requests exist', () => {
    render(<Dashboard />)
    expect(screen.getByText(/automation is unavailable for execution/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /automation/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Enabled · policy gated')).not.toBeInTheDocument()
    expect(screen.queryByText('SYSTEM OPERATIONAL')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Approvals' })
    expect(button).not.toHaveTextContent('2')
  })

  it('routes Applications to observed application inventory instead of generic environment view', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    await user.click(screen.getByRole('button', { name: 'Applications' }))
    expect(screen.getByRole('region', { name: 'Observed application services' })).toBeInTheDocument()
    expect(screen.getByText('Cloud Portal')).toBeInTheDocument()
  })

  it('clearly labels disconnected Tasks, Memory and Approvals as not activated', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    for (const name of ['Tasks', 'Memory', 'Approvals']) {
      await user.click(screen.getByRole('button', { name }))
      expect(screen.getByRole('heading', { name: name + ' is not connected' })).toBeInTheDocument()
      expect(screen.getByText(/No production task, memory or approval operation is available on this screen/i)).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /approve|delete|restart|execute/i })).not.toBeInTheDocument()
  })
})
