import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

function installFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/agents' && (!init?.method || init.method === 'GET')) return jsonResponse([agent])
    if (url === '/api/agents/registry/status') return jsonResponse(status)
    if (url === '/api/agents/registry/sync') return jsonResponse({ ...status, agentsSynced: 1 })
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
    expect(screen.getByRole('button', { name: 'Sync registry' })).toBeInTheDocument()

    for (const forbidden of ['Restart', 'Execute', 'Delete', 'Approve', 'Shell', 'Edit agent', 'Create agent']) {
      expect(screen.queryByRole('button', { name: new RegExp(forbidden, 'i') })).not.toBeInTheDocument()
    }
  })

  it('syncs only Friday-owned registry state from Git and refreshes status', async () => {
    const fetchMock = installFetch()
    render(<AgentsWorkspace />)
    await screen.findByText('Proxmox Observer')
    fireEvent.click(screen.getByRole('button', { name: 'Sync registry' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agents/registry/sync', expect.objectContaining({ method: 'POST', body: JSON.stringify({}) })))
    expect(screen.getByText(/Git is authoritative/i)).toBeInTheDocument()
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
