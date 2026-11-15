import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NewAgentPanel, { parsePermissions } from './NewAgentPanel'

afterEach(() => vi.unstubAllGlobals())

const setup = { repository: 'StMedrano/Friday', profiles: ['local-general', 'local-coder'] }

describe('NewAgentPanel', () => {
  it('shows Not connected with its setup link when proposals are off', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'agent-proposals-disabled' }), { status: 503 })))
    render(<NewAgentPanel/>)
    const note = await screen.findByRole('note', { name: 'New agents: not connected' })
    expect(within(note).getByRole('link', { name: 'How to connect: New agents from Friday' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Propose an agent' })).not.toBeInTheDocument()
  })

  it('opens a pull request from the form and links to it', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ proposal: { number: 12, url: 'https://github.com/StMedrano/Friday/pull/12', branch: 'friday/agent-dns-watcher-x', path: 'agents/dns-watcher.json' } }), { status: 201 })
      : new Response(JSON.stringify(setup), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<NewAgentPanel/>)
    expect(await screen.findByText(/opens a pull request on StMedrano\/Friday/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Propose an agent' }))
    const form = screen.getByRole('form', { name: 'Propose an agent' })
    fireEvent.change(within(form).getByLabelText('Id'), { target: { value: 'dns-watcher' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'DNS Watcher' } })
    fireEvent.change(within(form).getByLabelText('Purpose'), { target: { value: 'Watches DNS' } })
    fireEvent.change(within(form).getByLabelText(/Hosts/), { target: { value: 'adguard, pihole' } })
    fireEvent.change(within(form).getByLabelText(/Tools/), { target: { value: 'dns_read' } })
    fireEvent.change(within(form).getByLabelText(/Permissions/), { target: { value: 'inspect: auto\nrestart_service: approval' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Open pull request' }))
    const link = await screen.findByRole('link', { name: /Review it on GitHub/ })
    expect(link).toHaveAttribute('href', 'https://github.com/StMedrano/Friday/pull/12')
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      id: 'dns-watcher', name: 'DNS Watcher', description: 'Watches DNS', profile: 'local-general',
      hosts: ['adguard', 'pihole'], tools: ['dns_read'], permissions: { inspect: 'auto', restart_service: 'approval' },
      instructions: ['Inspect before proposing a repair.'], enabled: true,
    })
  })

  it('refuses auto on a non-reading action before sending, and explains server refusals', async () => {
    let answer: { status: number; body: unknown } = { status: 409, body: { error: 'agent-exists' } }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify(answer.body), { status: answer.status })
      : new Response(JSON.stringify(setup), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<NewAgentPanel/>)
    fireEvent.click(await screen.findByRole('button', { name: 'Propose an agent' }))
    const form = screen.getByRole('form', { name: 'Propose an agent' })
    for (const [label, value] of [['Id', 'proxmox-observer'], ['Name', 'Proxmox'], ['Purpose', 'Watch']] as const)
      fireEvent.change(within(form).getByLabelText(label), { target: { value } })
    fireEvent.change(within(form).getByLabelText(/Permissions/), { target: { value: 'restart_vm: auto' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Open pull request' }))
    expect(screen.getByText(/only inspect, read_, list_, get_, view_ or check_ actions may be auto/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    fireEvent.change(within(form).getByLabelText(/Permissions/), { target: { value: 'inspect: auto' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Open pull request' }))
    expect(await screen.findByText('An agent with this id is already in Git. Choose another id.')).toBeInTheDocument()
    answer = { status: 400, body: { error: 'invalid-agent-proposal', field: 'id' } }
    fireEvent.click(within(form).getByRole('button', { name: 'Open pull request' }))
    expect(await screen.findByText(/Check the id: lowercase letters/)).toBeInTheDocument()
  })

  it('parses permissions strictly', () => {
    expect(parsePermissions('inspect: auto\nlist_vms:auto\ndelete_vm: forbidden')).toEqual({ inspect: 'auto', list_vms: 'auto', delete_vm: 'forbidden' })
    expect(parsePermissions('restart_vm: auto')).toBeNull()
    expect(parsePermissions('inspect: sometimes')).toBeNull()
    expect(parsePermissions('inspect: auto\ninspect: approval')).toBeNull()
    expect(parsePermissions('')).toEqual({})
  })
})
