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

function installMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function liveFetch(options: { historyFails?: boolean; diagnostics?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === '/api/overview') {
      return new Response(JSON.stringify(liveOverview), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (path === '/api/monitoring/history') {
      if (options.historyFails) throw new Error('history offline')
      return new Response(JSON.stringify({ events: [{ id: 'h1', type: 'incident-opened', at: '2026-08-19T23:05:01.000Z', source: 'monitoring', detail: 'HIGH Service offline' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (path === '/api/incidents/npm-offline-1/diagnostics' && options.diagnostics) {
      return new Response(JSON.stringify({
        incidentId: 'npm-offline-1', status: 'available',
        facts: [{ id: 'exit-code', label: 'Exit code', value: '255' }],
        findings: ['Application/startup failure observed.'], likelyCauses: [], recommendations: ['Inspect approved diagnostics.'], logsAvailable: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`Unexpected fetch ${path}`)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Friday v3 command center', () => {
  it('presents the authoritative Friday command surface and live infrastructure data', () => {
    installMatchMedia(false)
    render(<Dashboard />)
    expect(screen.getByRole('heading', { name: /good afternoon/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /what would you like me to handle/i })).toBeInTheDocument()
    expect(screen.getAllByText('Proxmox VE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Omada Controller').length).toBeGreaterThan(0)
    expect(screen.getByPlaceholderText(/ask friday anything/i)).toBeInTheDocument()
    expect(screen.getByText(/safe read-only interface/i)).toBeInTheDocument()
  })

  it('fetches monitoring history when Incidents is activated', async () => {
    installMatchMedia(false)
    const fetchMock = liveFetch()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Dashboard />)

    expect(await screen.findByText(/API connected · live mode/i)).toBeInTheDocument()
    await user.click(screen.getByTitle('Incidents'))
    expect(await screen.findByText('HIGH Service offline')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/monitoring/history')).toHaveLength(1)
  })

  it('keeps active incidents visible when history loading fails', async () => {
    installMatchMedia(false)
    const fetchMock = liveFetch({ historyFails: true })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Dashboard />)

    await screen.findByText(/API connected · live mode/i)
    await user.click(screen.getByTitle('Incidents'))
    expect((await screen.findAllByText('nginx-proxy-manager')).length).toBeGreaterThan(0)
    expect(await screen.findByText(/history unavailable/i)).toBeInTheDocument()
  })

  it('uses mobile shell with bottom navigation and no desktop rail at phone width', async () => {
    installMatchMedia(true)
    vi.stubGlobal('fetch', liveFetch())
    render(<Dashboard />)

    expect(screen.getByRole('navigation', { name: /mobile command bar/i })).toBeInTheDocument()
    expect(document.querySelector('.v3-rail')).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: 'nginx-proxy-manager' })).toBeInTheDocument()

    const attention = document.querySelector('[data-mobile-section="attention"]')
    const friday = document.querySelector('[data-mobile-section="friday"]')
    expect(attention).not.toBeNull()
    expect(friday).not.toBeNull()
    expect(attention!.compareDocumentPosition(friday!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens the selected diagnosis from mobile Home and preserves history loading', async () => {
    installMatchMedia(true)
    const fetchMock = liveFetch({ diagnostics: true })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<Dashboard />)

    await screen.findByRole('heading', { level: 1, name: 'nginx-proxy-manager' })
    await user.click(screen.getByRole('button', { name: /view diagnosis/i }))

    expect(screen.getByRole('button', { name: /incidents, 1 active/i })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('heading', { name: /diagnosis · nginx-proxy-manager/i })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/monitoring/history')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/incidents/npm-offline-1/diagnostics')).toHaveLength(1)
  })

  it('preserves desktop V3 rail and command center above phone width', () => {
    installMatchMedia(false)
    render(<Dashboard />)
    expect(document.querySelector('.v3-rail')).not.toBeNull()
    expect(screen.getByRole('heading', { name: /what would you like me to handle/i })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /mobile command bar/i })).not.toBeInTheDocument()
  })
})
