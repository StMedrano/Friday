import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import IncidentDetail from './IncidentDetail'
import * as api from '../lib/api'
import type { FridayIncident } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    fetchIncidentDiagnostics: vi.fn(),
    fetchIncidentLogs: vi.fn(),
  }
})

const incident: FridayIncident = {
  id: 'i1',
  type: 'service-offline',
  title: 'Service offline',
  detail: 'nginx-proxy-manager is offline on VM 100',
  severity: 'high',
  status: 'open',
  source: 'monitoring',
  host: 'VM 100',
  serviceId: 'vm100-observer-npm',
  serviceName: 'nginx-proxy-manager',
  firstSeen: '2026-08-20T00:36:57.293Z',
  lastSeen: '2026-08-20T00:41:57.541Z',
  openedAt: '2026-08-20T00:41:57.541Z',
  resolvedAt: null,
  recommendedAction: 'Inspect approved diagnostics before any remediation.',
  evidence: ['Exited (255)'],
}

beforeEach(() => {
  vi.mocked(api.fetchIncidentDiagnostics).mockReset()
  vi.mocked(api.fetchIncidentLogs).mockReset()
})

describe('IncidentDetail', () => {
  it('renders facts, deterministic findings, recommendations, and read-only authority', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue({
      incidentId: 'i1',
      status: 'available',
      facts: [
        { id: 'exit-code', label: 'Exit code', value: '255' },
        { id: 'oom-killed', label: 'OOM killed', value: 'No' },
      ],
      findings: ['The container exited with an application/startup failure rather than an OOM termination.'],
      likelyCauses: ['Application or startup configuration failure is likely.'],
      recommendations: ['Inspect recent sanitized application logs and recent configuration/deployment changes.'],
      logsAvailable: true,
    })

    render(<IncidentDetail incident={incident} />)

    expect(await screen.findByText('255')).toBeInTheDocument()
    expect(screen.getByText(/application\/startup failure/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /facts/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /friday findings/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /recommendations/i })).toBeInTheDocument()
    expect(screen.getByText(/READ ONLY · NO REMEDIATION EXECUTED/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|repair|execute|stop|start container/i })).not.toBeInTheDocument()
  })

  it('does not request logs until Inspect Logs is explicitly activated', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue({
      incidentId: 'i1', status: 'available', facts: [], findings: [], recommendations: [], logsAvailable: true,
    })
    vi.mocked(api.fetchIncidentLogs).mockResolvedValue({
      incidentId: 'i1', serviceName: 'nginx-proxy-manager', host: 'VM 100', tail: 100,
      logs: 'safe application log', truncated: false,
    })
    const user = userEvent.setup()

    render(<IncidentDetail incident={incident} />)

    await screen.findByRole('button', { name: /inspect logs.*read only/i })
    expect(api.fetchIncidentLogs).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /inspect logs.*read only/i }))
    expect(api.fetchIncidentLogs).toHaveBeenCalledWith('i1', expect.any(AbortSignal))
    expect(await screen.findByText(/safe application log/i)).toBeInTheDocument()
  })

  it('renders pending and not-supported states without remediation controls', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue({ incidentId: 'i1', status: 'not-supported', reason: 'incident-not-supported' })
    render(<IncidentDetail incident={incident} />)
    expect(await screen.findByText(/diagnostics not supported/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /inspect logs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|repair|execute/i })).not.toBeInTheDocument()
  })

  it('keeps diagnostic and log failures explicitly non-mutating', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockRejectedValue(new Error('diagnostics-unavailable'))
    render(<IncidentDetail incident={incident} />)
    expect(await screen.findByText(/diagnostics are unavailable/i)).toBeInTheDocument()
    expect(screen.getByText(/no infrastructure action was attempted/i)).toBeInTheDocument()
  })

  it('shows a visible notice when explicit log output is truncated', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue({
      incidentId: 'i1', status: 'available', facts: [], findings: [], recommendations: [], logsAvailable: true,
    })
    vi.mocked(api.fetchIncidentLogs).mockResolvedValue({
      incidentId: 'i1', tail: 100, logs: 'bounded log output', truncated: true,
    })
    const user = userEvent.setup()
    render(<IncidentDetail incident={incident} />)
    await user.click(await screen.findByRole('button', { name: /inspect logs.*read only/i }))
    expect(await screen.findByText(/log output was truncated/i)).toBeInTheDocument()
  })
})
