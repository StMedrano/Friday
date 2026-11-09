import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentOnDuty, { agentsOnDuty } from './AgentOnDuty'
import type { FridayAgent } from '../lib/api'

const agent = (id: string, hosts: unknown, enabled = true) => ({
  version: '1.1', id, name: id === 'proxmox-observer' ? 'Proxmox Observer' : id, description: '', enabled,
  model: { profile: 'local-general' }, scope: { hosts }, tools: [], permissions: {}, source: {},
}) as FridayAgent

afterEach(() => vi.unstubAllGlobals())

describe('AgentOnDuty', () => {
  it('matches enabled agents by declared host scope', () => {
    const agents = [agent('proxmox-observer', ['proxmox']), agent('off', ['proxmox'], false), agent('dns', ['adguard']), agent('bad', 'proxmox')]
    expect(agentsOnDuty(agents, ['Proxmox host home', 'VM 100']).map((item) => item.id)).toEqual(['proxmox-observer'])
    expect(agentsOnDuty(agents, ['VM 100'])).toEqual([])
  })

  it('shows the agent covering the visible hosts and its last answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/agents'
      ? new Response(JSON.stringify([agent('proxmox-observer', ['proxmox'])]))
      : new Response(JSON.stringify({ events: [{ id: 'e1', at: '2026-11-05T10:00:00.000Z', agentId: 'proxmox-observer', outcome: 'answered', durationMs: 5 }] }))))
    render(<AgentOnDuty hosts={['proxmox']}/>)
    const card = await screen.findByRole('group', { name: 'Agent on duty' })
    expect(card).toHaveTextContent('Proxmox Observer')
    expect(card).toHaveTextContent('Scope: proxmox · last answered')
  })

  it('says when no agent is scoped and stays not connected without a registry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === '/api/agents'
      ? new Response(JSON.stringify([agent('proxmox-observer', ['proxmox'])]))
      : new Response(JSON.stringify({ error: 'agent-activity-disabled' }), { status: 503 })))
    const { unmount } = render(<AgentOnDuty hosts={['VM 100']}/>)
    expect(await screen.findByText('No enabled agent declares these hosts in its scope.')).toBeInTheDocument()
    unmount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agent-registry-unavailable' }), { status: 503 })))
    render(<AgentOnDuty hosts={['VM 100']}/>)
    expect(await screen.findByRole('note', { name: 'Agent on duty: not connected' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How to connect: Self-hosted Supabase runtime registry' })).toBeInTheDocument()
  })
})
