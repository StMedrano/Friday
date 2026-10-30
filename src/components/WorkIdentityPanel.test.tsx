import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkIdentityPanel from './WorkIdentityPanel'

afterEach(() => vi.unstubAllGlobals())

const hash = 'a'.repeat(64)

describe('WorkIdentityPanel', () => {
  it('shows this account’s work identity and that it has no access yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ subjectHash: hash, granted: false }), { status: 200 })))
    render(<WorkIdentityPanel />)
    expect(await screen.findByText(hash)).toBeInTheDocument()
    expect(screen.getByText(/No project access yet/)).toBeInTheDocument()
  })

  it('confirms when the account can read its projects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ subjectHash: hash, granted: true }), { status: 200 })))
    render(<WorkIdentityPanel />)
    expect(await screen.findByText(/can read its granted project tasks/)).toBeInTheDocument()
  })

  it('reports an unavailable identity rather than a blank panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    render(<WorkIdentityPanel />)
    expect(await screen.findByText('Your work identity is unavailable.')).toBeInTheDocument()
  })
})
