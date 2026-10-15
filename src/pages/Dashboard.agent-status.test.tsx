import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupWorkspace } from '../lib/api'

const mocks = vi.hoisted(() => ({ groups: vi.fn(), history:vi.fn(),phone: false,connected:true,mode:'live' as 'live'|'mock' }))
vi.mock('../lib/api', () => ({
  useFridayOverview: () => ({ connected: mocks.connected, overview: {
    mode: mocks.mode, sites: [], services: [], alerts: [], resources: [], activities: [], incidents: [], monitoring: null,
  } }),
  fetchFridayAgentGroups: (...args: unknown[]) => mocks.groups(...args),
  fetchMonitoringHistory: (...args:unknown[])=>mocks.history(...args),
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
  beforeEach(() => { mocks.phone = false; mocks.connected=true;mocks.mode='live';mocks.history.mockReset().mockResolvedValue([]);mocks.groups.mockReset(); mocks.groups.mockResolvedValue(workspace) })

  it.each(['disconnected','mock'] as const)('clears previous live history when overview becomes %s',async state=>{
    mocks.history.mockResolvedValue([{id:'old',type:'incident-opened',at:'2026-10-15T00:00:00Z',source:'fixture',detail:'Fixture old live record'}])
    const user=userEvent.setup()
    const view=render(<Dashboard/> )
    await screen.findByText('Fixture old live record')
    await user.click(screen.getByRole('button',{name:'Incidents'}))
    expect(screen.getByText('Fixture old live record')).toBeInTheDocument()
    if(state==='disconnected')mocks.connected=false
    else mocks.mode='mock'
    view.rerender(<Dashboard/> )
    await waitFor(()=>expect(screen.queryByText('Fixture old live record')).not.toBeInTheDocument())
    expect(screen.queryByRole('button',{name:'Refresh monitoring history'})).not.toBeInTheDocument()
    expect(screen.queryByText('0 recent events')).not.toBeInTheDocument()
  })

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

  it.each([false,true])('contains keyboard focus and restores the opener after closing (phone=%s)',async phone=>{
    mocks.phone=phone
    const user=userEvent.setup()
    render(<Dashboard/> )
    const opener=screen.getByRole('button',{name:phone?'Search Friday views':'Search or command'})
    await user.click(opener)
    const search=screen.getByRole('textbox',{name:'Search Friday views'})
    expect(search).toHaveFocus()
    await user.tab({shift:true})
    expect(screen.getByRole('button',{name:'Open Settings'})).toHaveFocus()
    await user.tab()
    expect(search).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(screen.getByRole('textbox',{name:'Search Friday views'}),'no-match-fixture')
    await user.click(screen.getByRole('button',{name:'Close search'}))
    expect(opener).toHaveFocus()
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

  it('dismisses only the top dialog when search opens above mobile More',async()=>{
    mocks.phone=true
    const user=userEvent.setup()
    render(<Dashboard/> )
    await user.click(screen.getByRole('button',{name:'More'}))
    expect(screen.getByRole('button',{name:'Applications'})).toHaveFocus()
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('textbox',{name:'Search Friday views'})).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog',{name:'More FRIDAY views'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Applications'})).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'More'})).toHaveFocus()
  })

  it('shows honest group quick links rather than invented running agents', async () => {
    const user = userEvent.setup()
    render(<Dashboard />)
    const homelab = await screen.findByRole('button', { name: 'Open HomeLab group' })
    expect(homelab).toHaveTextContent('HomeLab')
    expect(homelab).toHaveTextContent('1 configured')
    expect(homelab).toHaveTextContent('1 planned')
    expect(homelab).not.toHaveTextContent('running')
    await user.click(homelab)
    expect(screen.getByText('Group workspace destination')).toBeInTheDocument()
  })

})
