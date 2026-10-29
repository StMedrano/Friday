import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const events = [
  { id: 'e1', type: 'incident-opened', at: '2026-10-29T18:30:00.000Z', source: 'monitoring', host: 'home', serviceName: 'umbrel', detail: 'Service offline' },
]
const fetchMonitoringHistory = vi.fn(async () => events)

vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({ connected: true, overview: {
    mode: 'live', sites: [], services: [], alerts: [], resources: [], activities: [], incidents: [], monitoring: null,
  } }),
  fetchMonitoringHistory,
  askFridayAssistant: vi.fn(async () => ({ available: false, execution: { performed: false } })),
}))
vi.mock('../hooks/usePhoneLayout', () => ({ usePhoneLayout: () => false }))

afterEach(() => vi.clearAllMocks())

describe('Dashboard recent activity', () => {
  it('shows observed monitoring history on the home screen', async () => {
    const { default: Dashboard } = await import('./Dashboard')
    render(<Dashboard />)
    const panel = await screen.findByRole('region', { name: 'Operational activity timeline' })
    await waitFor(() => expect(within(panel).getByRole('list', { name: 'Recent monitoring events' })).toBeInTheDocument())
    expect(within(panel).getByText('Incident opened')).toBeInTheDocument()
    expect(within(panel).getByText('Service offline')).toBeInTheDocument()
    expect(within(panel).getByText('Observed data')).toBeInTheDocument()
  })

  it('reports unavailable history instead of an empty timeline', async () => {
    fetchMonitoringHistory.mockRejectedValueOnce(new Error('Friday monitoring history 503'))
    const { default: Dashboard } = await import('./Dashboard')
    render(<Dashboard />)
    const panel = await screen.findByRole('region', { name: 'Operational activity timeline' })
    await waitFor(() => expect(within(panel).getByText(/Monitoring history unavailable/)).toBeInTheDocument())
    expect(within(panel).queryByText('No monitoring events recorded')).not.toBeInTheDocument()
  })

  it('loads history once for the home screen and reuses it for Incidents', async () => {
    const { default: Dashboard } = await import('./Dashboard')
    const user = userEvent.setup()
    render(<Dashboard />)
    await screen.findByRole('region', { name: 'Operational activity timeline' })
    await waitFor(() => expect(fetchMonitoringHistory).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Incidents' }))
    expect(fetchMonitoringHistory).toHaveBeenCalledTimes(1)
  })
})
