import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentGroupsPanel from './AgentGroupsPanel'

afterEach(() => vi.unstubAllGlobals())

const workspace = {
  schemaVersion: '1',
  registryStatus: 'ok',
  executionEnabled: false,
  workStatus: 'not-connected',
  groups: [
    { id: 'homelab', name: 'HomeLab', members: [
      { id: 'homelab-observer', name: 'Observer', agentId: 'proxmox-observer', implementation: 'existing', state: 'configured', reason: 'Registered agent is configured; worker readiness is not connected.' },
      { id: 'homelab-planner', name: 'Planner', agentId: null, implementation: 'planned', state: 'catalogued', reason: 'Planned role; runtime integration is not configured.' },
    ] },
  ],
}

describe('AgentGroupsPanel', () => {
  it('shows each role with its honest readiness state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(workspace), { status: 200 })))
    render(<AgentGroupsPanel />)
    const roles = await screen.findByRole('list', { name: 'HomeLab roles' })
    expect(within(roles).getByText('Observer').closest('li')).toHaveTextContent('Configured')
    expect(within(roles).getByText('Planner').closest('li')).toHaveTextContent('Planned')
    expect(screen.getByText('1 configured of 2 roles')).toBeInTheDocument()
    expect(screen.getByText(/runs no group workers/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('warns when the registry is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...workspace, registryStatus: 'unavailable' }), { status: 200 })))
    render(<AgentGroupsPanel />)
    expect(await screen.findByText(/agent registry is unavailable/)).toBeInTheDocument()
  })

  it('reports an unavailable groups API instead of inventing groups', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'group-workspace-unavailable' }), { status: 503 })))
    render(<AgentGroupsPanel />)
    expect(await screen.findByText('Agent groups are unavailable.')).toBeInTheDocument()
  })

  it('rejects a malformed groups payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ schemaVersion: '1', groups: 'nope' }), { status: 200 })))
    render(<AgentGroupsPanel />)
    expect(await screen.findByText('Agent groups are unavailable.')).toBeInTheDocument()
  })
})
