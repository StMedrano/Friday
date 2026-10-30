import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({ connected: true, overview: {
    mode: 'live', sites: [], services: [], alerts: [], resources: [], activities: [], incidents: [], monitoring: null,
  } }),
  fetchMonitoringHistory: vi.fn(async () => []),
  askFridayAssistant: vi.fn(async () => ({ available: false, execution: { performed: false } })),
}))
vi.mock('../hooks/usePhoneLayout', () => ({ usePhoneLayout: () => true }))
vi.mock('../components/AuditWorkspace', () => ({ default: () => <div>Action audit view</div> }))
vi.mock('../components/SettingsWorkspace', () => ({ default: () => <div>Settings inspection view</div> }))

describe('Dashboard phone layout', () => {
  it('routes Settings and Audit to their real workspaces on a phone', async () => {
    const { default: Dashboard } = await import('./Dashboard')
    const user = userEvent.setup()
    render(<Dashboard />)

    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Settings inspection view')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings is not connected' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Audit' }))
    expect(screen.getByText('Action audit view')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Audit is not connected' })).not.toBeInTheDocument()
  })

  it('still marks genuinely unconnected workspaces on a phone', async () => {
    const { default: Dashboard } = await import('./Dashboard')
    const user = userEvent.setup()
    render(<Dashboard />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('button', { name: 'Memory' }))
    expect(screen.getByRole('heading', { name: 'Memory is not connected' })).toBeInTheDocument()
  })
})
