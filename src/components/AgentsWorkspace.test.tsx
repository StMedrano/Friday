import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import catalog from '../../server/agents/group-catalog.json'
import AgentsWorkspace from './AgentsWorkspace'

const agent = {
  version: '1.1',
  id: 'proxmox-observer',
  name: 'Proxmox Observer',
  description: 'Read-only Proxmox inventory and diagnostics.',
  enabled: true,
  model: { profile: 'local-general' },
  scope: { platforms: ['proxmox'], hosts: ['VM 100', 'LXC 108'] },
  tools: ['proxmox_read', 'inventory_read'],
  permissions: { read: ['proxmox.inventory'], write: [] },
  source: { path: 'agents/proxmox-observer.json', checksum: 'abc123checksum', syncedAt: '2026-08-30T18:00:00.000Z' },
}

const status = {
  id: 'git', status: 'ok', lastSyncAt: '2026-08-30T18:00:00.000Z', sourceCommit: 'abc1234',
  agentsSeen: 1, agentsSynced: 1, agentsRejected: 0, errors: [],
}

function jsonResponse(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'content-type': 'application/json' } })
}

const workspace = { ...catalog, registryStatus: 'ok', executionEnabled: false, workStatus: 'not-connected',
  groups: catalog.groups.map(group => ({ ...group, members: group.members.map(member => ({
    ...member, state: member.agentId ? 'configured' : 'catalogued', reason: member.agentId ? 'Registry enabled; advisory only.' : 'Proposed role; no registered binding.',
  })) })) }

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/agent-groups') return jsonResponse(workspace)
    if (url === '/api/agents' && (!init?.method || init.method === 'GET')) return jsonResponse([agent])
    if (url === '/api/agents/registry/status') return jsonResponse(status)
    if (url === '/api/agents/proxmox-observer/ask') return jsonResponse({
      available: true, mode: 'local-agent', provider: 'ollama', agentId: 'proxmox-observer', agentName: 'Proxmox Observer',
      modelProfile: 'local-general', model: 'qwen3:4b-instruct', text: 'VM 100 is observed as online.',
      execution: { performed: false, reason: 'Phase 1 agents are advisory only.' },
    })
    return jsonResponse({ error: 'not-found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('AgentsWorkspace', () => {
  it('renders healthy Git-backed local registry metadata and no action controls', async () => {
    installFetch()
    render(<AgentsWorkspace />)

    expect(await screen.findByText('LOCAL AGENT REGISTRY')).toBeInTheDocument()
    expect(screen.getByText(/Advisory only · No actions executed/)).toBeInTheDocument()
    expect(screen.getByText('Proxmox Observer')).toBeInTheDocument()
    expect(screen.getByText('local-general')).toBeInTheDocument()
    expect(screen.getByText('Local Ollama')).toBeInTheDocument()
    expect(screen.getByText(/VM 100/)).toBeInTheDocument()
    expect(screen.getByText(/proxmox_read/)).toBeInTheDocument()
    expect(screen.getByText(/abc123checksum/)).toBeInTheDocument()
    expect(screen.getByText(/Aug 30, 2026|2026-08-30/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask this agent' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync registry' })).not.toBeInTheDocument()

    for (const forbidden of ['Restart', 'Execute', 'Delete', 'Approve', 'Shell', 'Edit agent', 'Create agent']) {
      expect(screen.queryByRole('button', { name: new RegExp(forbidden, 'i') })).not.toBeInTheDocument()
    }
  })

  it('does not expose an unauthenticated registry write action', async () => {
    const fetchMock = installFetch()
    render(<AgentsWorkspace />)
    await screen.findByText('Proxmox Observer')
    expect(screen.queryByRole('button', { name: 'Sync registry' })).not.toBeInTheDocument()
    expect(screen.getByText(/Git is authoritative/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/agents/registry/sync', expect.anything())
  })

  it('manually asks the selected agent and renders local-only provenance and execution=false', async () => {
    const fetchMock = installFetch()
    render(<AgentsWorkspace />)
    await screen.findByText('Proxmox Observer')
    fireEvent.change(screen.getByLabelText('Ask selected agent'), { target: { value: 'Check VM 100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask this agent' }))

    expect(await screen.findByText('VM 100 is observed as online.')).toBeInTheDocument()
    expect(screen.getByText(/ollama · qwen3:4b-instruct/i)).toBeInTheDocument()
    expect(screen.getByText(/No actions executed.*execution\.performed=false/i)).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agents/proxmox-observer/ask', expect.objectContaining({ method: 'POST', body: JSON.stringify({ prompt: 'Check VM 100' }) })))
  })

  it('renders registry unavailable safely without inventing agents', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'agent-registry-unavailable' }, 503)))
    render(<AgentsWorkspace />)
    expect(await screen.findByText(/Agent registry unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText('Proxmox Observer')).not.toBeInTheDocument()
  })
})

describe('group workspace', () => {
  it('shows group counts, planned details and only exact HomeLab binding', async () => {
    installFetch()
    render(<AgentsWorkspace />)
    for (const name of ['TechTactics · 7 roles', 'App Builder · 5 roles', 'HomeLab · 7 roles']) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'TechTactics · 7 roles' }))
    fireEvent.click(screen.getByRole('button', { name: /Manager.*Planned/i }))
    expect(screen.getByRole('button', { name: 'Ask this agent' })).toBeDisabled()
    expect(screen.queryByText('abc123checksum')).not.toBeInTheDocument()
    expect(screen.getByText('Work integration not connected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'HomeLab · 7 roles' }))
    fireEvent.click(screen.getByRole('button', { name: /Proxmox Observer.*Configured/i }))
    expect(screen.getByText('abc123checksum')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /execute|approve|send|restart|delete/i })).not.toBeInTheDocument()
  })

  it('supports keyboard group selection and clears prior detail', async () => {
    installFetch()
    const user = userEvent.setup()
    render(<AgentsWorkspace />)
    const home = await screen.findByRole('button', { name: 'HomeLab · 7 roles' })
    home.focus()
    await user.keyboard('{Enter}')
    fireEvent.click(screen.getByRole('button', { name: /Proxmox Observer.*Configured/i }))
    const app = screen.getByRole('button', { name: 'App Builder · 5 roles' })
    app.focus()
    await user.keyboard(' ')
    expect(app).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('abc123checksum')).not.toBeInTheDocument()
  })

  it('preserves registry when groups fail', async () => {
    const fetchMock = installFetch()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => String(input) === '/api/agent-groups' ? jsonResponse({}, 503) : original(input, init))
    render(<AgentsWorkspace />)
    expect(await screen.findByText('Group workspace unavailable')).toBeInTheDocument()
    expect(await screen.findByText('abc123checksum')).toBeInTheDocument()
  })

  it('aborts load requests on unmount', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn((_input, init) => {
      signals.push(init.signal)
      return new Promise(() => {})
    }))
    const { unmount } = render(<AgentsWorkspace />)
    unmount()
    expect(signals).toHaveLength(3)
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('aborts ask and ignores a reply that resolves after switching group', async () => {
    const fetchMock = installFetch()
    const original = fetchMock.getMockImplementation()!
    let resolve!: (response: Response) => void
    let askSignal: AbortSignal | undefined
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/ask')) {
        askSignal = init?.signal as AbortSignal
        return new Promise<Response>(done => { resolve = done })
      }
      return original(input, init)
    })
    render(<AgentsWorkspace />)
    await screen.findByText('abc123checksum')
    fireEvent.change(screen.getByLabelText('Ask selected agent'), { target: { value: 'Check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask this agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'App Builder · 5 roles' }))
    expect(askSignal?.aborted).toBe(true)
    await act(async () => { resolve(jsonResponse({ text: 'Stale HomeLab reply' })); await Promise.resolve() })
    await waitFor(() => expect(screen.queryByText('Stale HomeLab reply')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'All registered agents' }))
    expect(screen.queryByText('Stale HomeLab reply')).not.toBeInTheDocument()
  })
})

describe('group availability', () => {
  it('retains declared groups during a registry outage and prevents bound asks', async () => {
    vi.stubGlobal('fetch', vi.fn(async input => String(input) === '/api/agent-groups'
      ? jsonResponse({ ...workspace, registryStatus: 'unavailable', groups: workspace.groups.map(group => ({
        ...group, members: group.members.map(member => member.agentId ? { ...member, state: 'unavailable', reason: 'Registry unavailable.' } : member),
      })) })
      : jsonResponse({}, 503)))
    render(<AgentsWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'HomeLab · 7 roles' }))
    expect(await screen.findByText('Agent registry unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Proxmox Observer.*Unavailable/i }))
    expect(screen.getByRole('button', { name: 'Ask this agent' })).toBeDisabled()
    expect(screen.queryByText('Local Ollama')).not.toBeInTheDocument()
  })

  it('shows disabled binding policy while denying advisory asks', async () => {
    const fetchMock = installFetch()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === '/api/agents') return jsonResponse([{ ...agent, enabled: false }])
      if (String(input) === '/api/agent-groups') return jsonResponse({ ...workspace, groups: workspace.groups.map(group => ({
        ...group, members: group.members.map(member => member.agentId ? { ...member, state: 'disabled' } : member),
      })) })
      return original(input, init)
    })
    render(<AgentsWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: 'HomeLab · 7 roles' }))
    fireEvent.click(screen.getByRole('button', { name: /Proxmox Observer.*Disabled/i }))
    expect(await screen.findByText('abc123checksum')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask this agent' })).toBeDisabled()
  })
})
