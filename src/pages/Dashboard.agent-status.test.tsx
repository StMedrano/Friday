import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupWorkspace } from '../lib/api'

const mocks = vi.hoisted(() => ({ groups: vi.fn(), phone: false }))
vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({ connected: true, overview: {
    mode: 'live', sites: [], services: [], alerts: [], resources: [], activities: [], incidents: [], monitoring: null,
  } }),
  fetchFridayAgentGroups: (...args: unknown[]) => mocks.groups(...args),
  fetchMonitoringHistory: vi.fn(async () => []),
  askFridayAssistant: vi.fn(),
}))
vi.mock('../hooks/usePhoneLayout', () => ({ usePhoneLayout: () => mocks.phone }))
vi.mock('../components/AgentsWorkspace', () => ({ default: () => <h2>Group workspace destination</h2> }))
import Dashboard from './Dashboard'

const workspace: GroupWorkspace = {
  schemaVersion: '1', registryStatus: 'ok', executionEnabled: false, workStatus: 'not-connected',
  groups: [{ id: 'homelab', name: 'HomeLab', members: [
    { id: 'observer', name: 'Proxmox Observer', agentId: 'proxmox-observer', implementation: 'existing', state: 'configured', reason: 'Enabled registry definition.' },
    { id: 'planned', name: 'Security', agentId: null, implementation: 'planned', state: 'catalogued', reason: 'Proposed role only.' },
    { id: 'disabled', name: 'Disabled role', agentId: 'disabled-role', implementation: 'existing', state: 'disabled', reason: 'Disabled registry definition.' },
  ] }],
}

describe('Dashboard truthful agent status', () => {
  beforeEach(() => { mocks.phone = false; mocks.groups.mockReset(); mocks.groups.mockResolvedValue(workspace) })

  it('shows registry-configured counts without claiming active workers or a policy toggle', async () => {
    render(<Dashboard />)
    expect(await screen.findByText('1 configured member')).toBeInTheDocument()
    expect(screen.getByText('Configured does not mean running.')).toBeInTheDocument()
    expect(screen.getByText('Actions not enabled')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    for (const text of ['Active agents', 'Monitoring', 'Infrastructure synchronized', 'Security', 'ACTIVE', 'READY', 'Enabled · policy gated']) {
      expect(screen.queryByText(text, { exact: true })).not.toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'View Agents configuration' }))
    expect(screen.getByText('Group workspace destination')).toBeInTheDocument()
  })

  it.each(['request', 'registry'])('shows unavailable status for %s failure without a fabricated zero', async failure => {
    if (failure === 'request') mocks.groups.mockRejectedValue(new Error('unavailable'))
    else mocks.groups.mockResolvedValue({ ...workspace, registryStatus: 'unavailable' })
    render(<Dashboard />)
    expect(await screen.findByText('Agent configuration unavailable')).toBeInTheDocument()
    expect(screen.queryByText(/\d+ configured member/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Agents configuration' })).toBeInTheDocument()
  })

  it('preserves phone navigation to Agents and honest overview status', async () => {
    mocks.phone = true
    render(<Dashboard />)
    expect(await screen.findByText('1 configured member')).toBeInTheDocument()
    expect(screen.getByText('Actions not enabled')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'View Agents configuration' }))
    expect(screen.getByText('Group workspace destination')).toBeInTheDocument()
  })

  it('aborts overview reads on navigation and ignores a late previous response', async () => {
    let resolveFirst!: (value: GroupWorkspace) => void
    mocks.groups.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ ...workspace, groups: [] })
    const view = render(<Dashboard />)
    await userEvent.click(screen.getByRole('button', { name: 'Agents' }))
    expect(mocks.groups.mock.calls[0][0].aborted).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(await screen.findByText('0 configured members')).toBeInTheDocument()
    resolveFirst(workspace)
    await waitFor(() => expect(screen.queryByText('1 configured member')).not.toBeInTheDocument())
    view.unmount()
    expect(mocks.groups.mock.calls[1][0].aborted).toBe(true)
  })
  it('opens desktop search, navigates to a view, and supports collapsing the sidebar', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeInTheDocument()
    expect(screen.queryByText('2', { selector: '.v3-rail nav i' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search or command' }))
    expect(screen.getByRole('dialog', { name: 'Friday command palette' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search Friday views' }), 'Agents')
    await user.click(screen.getByRole('button', { name: 'Open Agents' }))
    expect(screen.getByText('Group workspace destination')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Friday command palette' })).not.toBeInTheDocument()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Friday command palette' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Friday command palette' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }))
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeInTheDocument()
  })

  it('offers phone navigation search without a live-action promise', async () => {
    mocks.phone = true
    const user = userEvent.setup()
    render(<Dashboard />)
    await user.click(screen.getByRole('button', { name: 'Search Friday views' }))
    expect(screen.getByRole('dialog', { name: 'Friday command palette' })).toBeInTheDocument()
    expect(screen.getByText('Actions not enabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close search' }))
    expect(screen.queryByRole('dialog', { name: 'Friday command palette' })).not.toBeInTheDocument()
  })

})
