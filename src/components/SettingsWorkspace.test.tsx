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

  it('shows nothing about the service token when no expiry date is configured', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...settings, serviceToken: null }), { status: 200 })))
    render(<SettingsWorkspace />)
    await screen.findByRole('region', { name: 'Integrations' })
    expect(screen.queryByText('Service token')).not.toBeInTheDocument()
    expect(screen.queryByTestId('service-token-expiry')).not.toBeInTheDocument()
  })

  it.each([
    [{ expiresAt: '2026-12-31', daysRemaining: 53, state: 'ok' }, 'Expires in 53 days (2026-12-31)', 'off'],
    [{ expiresAt: '2026-11-22', daysRemaining: 14, state: 'warning' }, 'Expires in 14 days (2026-11-22). Renew it soon.', 'warn'],
    [{ expiresAt: '2026-11-09', daysRemaining: 1, state: 'warning' }, 'Expires in 1 day (2026-11-09). Renew it soon.', 'warn'],
    [{ expiresAt: '2026-11-08', daysRemaining: 0, state: 'warning' }, 'Expires today (2026-11-08). Renew it soon.', 'warn'],
    [{ expiresAt: '2026-11-07', daysRemaining: -1, state: 'expired' }, 'Expired on 2026-11-07. Renew it now.', 'error'],
  ])('shows the service token expiry %#', async (serviceToken, text, tone) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...settings, serviceToken }), { status: 200 })))
    render(<SettingsWorkspace />)
    const expiry = await screen.findByTestId('service-token-expiry')
    expect(expiry).toHaveTextContent(text)
    expect(expiry).toHaveClass(`v3-settings-pill`, tone)
    expect(expiry.getAttribute('role')).toBe(serviceToken.state === 'ok' ? null : 'status')
  })

  it('reports an unavailable settings API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'access-denied' }), { status: 403 })))
    render(<SettingsWorkspace />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Settings are unavailable/)
  })
})

describe('SettingsWorkspace opt-in features', () => {
  const features = [
    { id: 'github', name: 'GitHub pull requests and CI', enabled: true, configured: true, setup: 'GitHub pull requests, CI and last commit' },
    { id: 'uptime', name: 'Uptime history', enabled: true, configured: false, setup: 'Uptime history' },
    { id: 'approvals', name: 'Approvals queue', enabled: false, configured: true, setup: 'Approvals queue' },
    { id: 'future', name: 'Something new', enabled: false, configured: false, setup: 'Not a documented section' },
  ]

  it('lists each feature as on or off, flags one that is on but incomplete, and links its setup doc', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...settings, features }), { status: 200 })))
    render(<SettingsWorkspace />)
    const panel = await screen.findByRole('region', { name: 'Features' })
    expect(panel).toHaveTextContent('2 of 4 on')
    const row = (name: string) => within(panel).getByText(name).closest('li') as HTMLElement
    expect(row('GitHub pull requests and CI')).toHaveTextContent('On')
    expect(row('GitHub pull requests and CI')).not.toHaveTextContent('Incomplete')
    expect(row('Uptime history')).toHaveTextContent('Incomplete')
    expect(row('Approvals queue')).toHaveTextContent('Off')
    expect(row('Approvals queue')).not.toHaveTextContent('Incomplete')
    expect(within(row('Uptime history')).getByRole('link', { name: 'How to turn on: Uptime history' }))
      .toHaveAttribute('href', 'https://github.com/StMedrano/Friday/blob/main/docs/integrations.md#uptime-history')
    // An unknown section is not linked.
    expect(within(row('Something new')).queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows no features panel when the server does not report features', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(settings), { status: 200 })))
    render(<SettingsWorkspace />)
    await screen.findByRole('region', { name: 'Integrations' })
    expect(screen.queryByRole('region', { name: 'Features' })).not.toBeInTheDocument()
  })
})
