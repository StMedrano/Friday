import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../src/pages/Dashboard'

const incident = {
  id: 'npm-offline-1',
  type: 'service-offline',
  title: 'Service offline',
  detail: 'nginx-proxy-manager is offline on VM 100',
  severity: 'high',
  status: 'open',
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

const liveOverview = {
  mode: 'live',
  generatedAt: '2026-08-19T23:05:01.000Z',
  sites: [],
  services: [],
  alerts: [],
  resources: [],
  activities: [],
  integrations: [],
  incidents: [incident],
  monitoring: {
    enabled: true,
    status: 'ok',
    lastPollAt: '2026-08-19T23:05:01.000Z',
    lastSuccessAt: '2026-08-19T23:05:01.000Z',
    lastError: null,
    activeIncidents: 1,
    openHigh: 1,
    openWarning: 0,
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Friday v3 command center', () => {
  it('presents the authoritative Friday command surface and live infrastructure data', () => {
    render(<Dashboard />)
    expect(screen.getByRole('heading', { name: /good afternoon/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /what would you like me to handle/i })).toBeInTheDocument()
    expect(screen.getAllByText('Proxmox VE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Omada Controller').length).toBeGreaterThan(0)
    expect(screen.getByPlaceholderText(/ask friday anything/i)).toBeInTheDocument()
    expect(screen.getByText(/safe read-only interface/i)).toBeInTheDocument()
  })

  it('fetches monitoring history when Incidents is activated', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/overview') {
        return new Response(JSON.stringify(liveOverview), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/api/monitoring/history') {
        return new Response(JSON.stringify({ events: [{ id: 'h1', type: 'incident-opened', at: '2026-08-19T23:05:01.000Z', source: 'monitoring', detail: 'HIGH Service offline' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`Unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Dashboard />)

    expect(await screen.findByText(/API connected · live mode/i)).toBeInTheDocument()
    await user.click(screen.getByTitle('Incidents'))
    expect(await screen.findByText('HIGH Service offline')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/monitoring/history')).toHaveLength(1)
  })

  it('keeps active incidents visible when history loading fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/overview') {
        return new Response(JSON.stringify(liveOverview), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (String(input) === '/api/monitoring/history') throw new Error('history offline')
      throw new Error(`Unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Dashboard />)

    await screen.findByText(/API connected · live mode/i)
    await user.click(screen.getByTitle('Incidents'))
    expect(await screen.findByText('nginx-proxy-manager')).toBeInTheDocument()
    expect(await screen.findByText(/history unavailable/i)).toBeInTheDocument()
  })
})
