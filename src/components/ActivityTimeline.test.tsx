import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ActivityTimeline from './ActivityTimeline'
import type { ActivityItem } from '../lib/infrastructure'
import type { MonitoringEvent } from '../lib/api'

const samples: ActivityItem[] = [
  { id: 'demo-1', title: 'Example maintenance', detail: 'Demonstration only', status: 'degraded', time: '5 min ago' },
]
const events: MonitoringEvent[] = [
  { id: 'older', type: 'service-degraded', at: '2026-10-14T18:30:00.000Z', source: 'monitor', host: 'vm100', serviceName: 'AdGuard', detail: 'Check returned warning' },
  { id: 'newer', type: 'incident-opened', at: '2026-10-14T19:30:00.000Z', source: 'monitor', host: 'vm102', serviceName: 'Friday', detail: 'Incident recorded' },
]
const base = { connected: true, mode: 'live' as const, events, examples: samples, loading: false, error: null, onOpenIncidents: vi.fn() }

describe('ActivityTimeline', () => {
  it.each(['Monitoring disabled','Monitoring history response invalid'])('shows %s without claiming empty history',message=>{
    render(<ActivityTimeline {...base} events={[]} error={message}/>)
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(screen.queryByText('No monitoring events recorded')).not.toBeInTheDocument()
  })
  it('shows verified monitoring history in most-recent-first order and never inserts examples into live data', () => {
    render(<ActivityTimeline {...base}/>)
    const list = screen.getByRole('list', { name: 'Recent monitoring events' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Incident opened')
    expect(items[0]).toHaveTextContent('Friday')
    expect(items[1]).toHaveTextContent('Service degraded')
    expect(items[1]).toHaveTextContent('AdGuard')
    expect(screen.queryByText('Example maintenance')).not.toBeInTheDocument()
    expect(screen.getByText('MONITORING HISTORY')).toBeInTheDocument()
    expect(screen.getByText('Observed data')).toBeInTheDocument()
  })

  it('labels mock activity clearly even when the demo backend is connected', () => {
    render(<ActivityTimeline {...base} mode="mock"/>)
    expect(screen.getByText('Example maintenance')).toBeInTheDocument()
    expect(screen.getByText('Demo examples')).toBeInTheDocument()
    expect(screen.queryByText('Incident opened')).not.toBeInTheDocument()
  })

  it('does not claim live evidence when the overview connection is unavailable', () => {
    render(<ActivityTimeline {...base} connected={false}/>)
    expect(screen.getByText('Preview only — not connected to Friday')).toBeInTheDocument()
    expect(screen.queryByText('Observed data')).not.toBeInTheDocument()
    expect(screen.queryByText('Incident opened')).not.toBeInTheDocument()
  })

  it('shows distinct loading, no-history, and failed-history states without falling back to demo events', () => {
    const { rerender } = render(<ActivityTimeline {...base} events={[]} loading/>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading monitoring history')
    rerender(<ActivityTimeline {...base} events={[]}/>)
    expect(screen.getByRole('status')).toHaveTextContent('No monitoring events recorded')
    rerender(<ActivityTimeline {...base} events={[]} error="History unavailable"/>)
    expect(screen.getByRole('status')).toHaveTextContent('Monitoring history unavailable')
    expect(screen.queryByText('Example maintenance')).not.toBeInTheDocument()
  })

  it('opens the existing Incidents view instead of offering simulated action controls', async () => {
    const onOpenIncidents = vi.fn()
    render(<ActivityTimeline {...base} onOpenIncidents={onOpenIncidents}/>)
    await userEvent.click(screen.getByRole('button', { name: 'Open monitoring history' }))
    expect(onOpenIncidents).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /restart|approve|deploy/i })).not.toBeInTheDocument()
  })
})
