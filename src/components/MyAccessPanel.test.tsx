import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MyAccessPanel from './MyAccessPanel'

afterEach(() => vi.unstubAllGlobals())
const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('MyAccessPanel', () => {
  it('says operators must use Authentik and that this sign-in was verified', async () => {
    vi.stubGlobal('fetch', reply({ signedIn: true, email: 'op@example.com', operator: true, providerVerified: true }))
    render(<MyAccessPanel provider={{ state: 'required', claim: 'custom.friday_auth_source', value: 'authentik' }}/>)
    expect(screen.getByText(/Operators must sign in with authentik/)).toBeInTheDocument()
    expect(await screen.findByText(/Signed in as op@example.com: operator. Verified through authentik./)).toBeInTheDocument()
  })

  it('explains a break-glass sign-in without operator rights', async () => {
    vi.stubGlobal('fetch', reply({ signedIn: true, email: 'pin@example.com', operator: false, providerVerified: false }))
    render(<MyAccessPanel provider={{ state: 'required', claim: 'custom.friday_auth_source', value: 'authentik' }}/>)
    expect(await screen.findByText(/did not come through the required provider/)).toBeInTheDocument()
  })

  it('warns when the rule is half set', async () => {
    vi.stubGlobal('fetch', reply({ signedIn: false }))
    render(<MyAccessPanel provider={{ state: 'invalid' }}/>)
    expect(screen.getByText(/misconfigured, so every operator action is denied/)).toBeInTheDocument()
    expect(await screen.findByText(/Not signed in through Cloudflare Access/)).toBeInTheDocument()
  })
})
