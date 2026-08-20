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
    rerunIncidentDiagnostics: vi.fn(),
  }
})

const incident: FridayIncident = {
  id: 'i1', type: 'service-offline', title: 'Service offline', detail: 'nginx-proxy-manager is offline on VM 100', severity: 'high',
  status: 'open', source: 'monitoring', host: 'VM 100', serviceId: 'vm100-observer-abcdef123456', serviceName: 'nginx-proxy-manager',
  firstSeen: '2026-08-20T00:36:57.293Z', lastSeen: '2026-08-20T00:41:57.541Z', openedAt: '2026-08-20T00:41:57.541Z',
  resolvedAt: null, recommendedAction: 'Inspect approved diagnostics before any remediation.', evidence: ['Exited (255)'],
}

const oldReport: api.DiagnosticReport = {
  incidentId: 'i1', status: 'available',
  facts: [{ id: 'exit-code', label: 'Exit code', value: '255' }],
  findings: ['The container exited with an application/startup failure rather than an OOM termination.'],
  likelyCauses: ['Application or startup configuration failure is likely.'],
  recommendations: ['Inspect recent sanitized application logs and recent configuration/deployment changes.'],
  logsAvailable: true,
  lastLogInspectionAt: '2026-08-20T17:04:58.452Z',
}

const freshReport: api.DiagnosticReport = {
  ...oldReport,
  collectedAt: '2026-08-20T22:00:00.000Z',
  findings: ['The container exited with a runtime/application failure rather than an OOM termination.'],
  likelyCauses: ['A runtime application or dependency failure is likely.'],
}

beforeEach(() => {
  vi.mocked(api.fetchIncidentDiagnostics).mockReset()
  vi.mocked(api.fetchIncidentLogs).mockReset()
  vi.mocked((api as typeof api & { rerunIncidentDiagnostics: ReturnType<typeof vi.fn> }).rerunIncidentDiagnostics).mockReset()
})

describe('IncidentDetail diagnostic rerun', () => {
  it('refreshes the visible diagnosis and clears previously fetched ephemeral logs', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue(oldReport)
    vi.mocked(api.fetchIncidentLogs).mockResolvedValue({ incidentId: 'i1', tail: 100, logs: 'old ephemeral log line', truncated: false })
    vi.mocked((api as typeof api & { rerunIncidentDiagnostics: ReturnType<typeof vi.fn> }).rerunIncidentDiagnostics).mockResolvedValue(freshReport)
    const user = userEvent.setup()

    render(<IncidentDetail incident={incident} />)

    expect(await screen.findByText(/application\/startup failure/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /inspect logs.*read only/i }))
    expect(await screen.findByText(/old ephemeral log line/i)).toBeInTheDocument()

    const rerunButton = screen.getByRole('button', { name: /re-run diagnosis.*read only/i })
    await user.click(rerunButton)

    expect((api as typeof api & { rerunIncidentDiagnostics: ReturnType<typeof vi.fn> }).rerunIncidentDiagnostics).toHaveBeenCalledWith('i1', expect.any(AbortSignal))
    expect(await screen.findByText(/runtime\/application failure/i)).toBeInTheDocument()
    expect(screen.queryByText(/application\/startup failure/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/old ephemeral log line/i)).not.toBeInTheDocument()
    expect(screen.getByText(/READ ONLY · NO REMEDIATION EXECUTED/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /restart|repair|execute|stop|start container/i })).not.toBeInTheDocument()
  })

  it('keeps the existing diagnosis visible when rerun fails', async () => {
    vi.mocked(api.fetchIncidentDiagnostics).mockResolvedValue(oldReport)
    vi.mocked((api as typeof api & { rerunIncidentDiagnostics: ReturnType<typeof vi.fn> }).rerunIncidentDiagnostics).mockRejectedValue(new Error('diagnostic-rerun-failed'))
    const user = userEvent.setup()

    render(<IncidentDetail incident={incident} />)
    expect(await screen.findByText(/application\/startup failure/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /re-run diagnosis.*read only/i }))

    expect(await screen.findByText(/refresh failed.*no infrastructure action was attempted/i)).toBeInTheDocument()
    expect(screen.getByText(/application\/startup failure/i)).toBeInTheDocument()
  })
})
