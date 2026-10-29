import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsWorkspace from './SettingsWorkspace'

afterEach(() => vi.unstubAllGlobals())

const settings = {
  mode: 'live',
  access: { originVerification: true, configured: true, operators: 0 },
  integrations: [
    { id: 'proxmox', name: 'Proxmox VE', enabled: true, configured: true, credentials: 'present', site: null, tls: 'unverified' },
    { id: 'adguard', name: 'AdGuard Home', enabled: false, configured: false, credentials: 'missing', site: 'Site A', tls: null },
    { id: 'endpoints', name: 'HTTP endpoint checks', enabled: true, configured: false, credentials: 'not-required', site: null, tls: null, checks: 0, error: 'invalid-endpoint-configuration' },
  ],
  ai: { enabled: true, providerOrder: ['groq', 'ollama'], cloudTimeoutMs: 15000, localTimeoutMs: 45000, providers: [
    { id: 'groq', inOrder: true, credentials: 'present', model: 'llama' },
    { id: 'ollama', inOrder: true, credentials: 'not-required', model: 'qwen3:4b-instruct', enabled: false },
    { id: 'openai', inOrder: false, credentials: 'missing', model: null },
  ] },
  monitoring: { enabled: true, pollSeconds: 30, offlineGraceSeconds: 300, historyLimit: 2000, diagnostics: false },
  automationApi: { enabled: false, port: 3011, serviceTokens: 0, readOnly: true },
  audit: { enabled: true, integrity: 'verified', events: 12 },
  safety: { writableSettings: false, infrastructureActions: false, executor: false },
}

describe('SettingsWorkspace', () => {
  it('shows server configuration posture with no environment controls', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response(JSON.stringify(settings), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SettingsWorkspace />)

    const integrations = await screen.findByRole('region', { name: 'Integrations' })
    const proxmox = within(integrations).getByText('Proxmox VE').closest('li') as HTMLElement
    expect(proxmox).toHaveTextContent('Enabled')
    expect(proxmox).toHaveTextContent('TLS not verified')
    const endpoints = within(integrations).getByText('HTTP endpoint checks').closest('li') as HTMLElement
    expect(endpoints).toHaveTextContent('Incomplete')
    expect(endpoints).toHaveTextContent('invalid-endpoint-configuration')
    expect(within(integrations).getByText('AdGuard Home').closest('li')).toHaveTextContent('Site A')
    expect(screen.getByText(/No operators configured/)).toBeInTheDocument()
    expect(screen.getByText('Enabled · chain verified · 12 events')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'AI providers' })).toHaveTextContent('1. groq')
    expect(screen.getByText(/change everything else in the server environment/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('reports an unavailable settings API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'access-denied' }), { status: 403 })))
    render(<SettingsWorkspace />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Settings are unavailable/)
  })
})
