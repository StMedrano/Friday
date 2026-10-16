import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RepositoriesWorkspace from './RepositoriesWorkspace'

afterEach(() => vi.unstubAllGlobals())

describe('RepositoriesWorkspace', () => {
  it('browses registered repositories through read-only status, list, and text requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input)
      const body = url === '/api/repositories'
        ? [{ id: 'friday', name: 'Friday Controller', defaultBranch: 'main', mode: 'read-only', enabled: true }]
        : url.endsWith('/status') ? { branch: 'feature/docs', dirty: true }
          : url.includes('/files?') ? ['README.md', 'src/index.ts']
            : { path: 'README.md', content: '# Friday\nRead-only workspace.' }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<RepositoriesWorkspace />)

    expect(await screen.findByText('Friday Controller')).toBeInTheDocument()
    expect(await screen.findByText('feature/docs')).toBeInTheDocument()
    expect(screen.getByText(/Working tree has local changes/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'README.md' }))
    const preview = await screen.findByLabelText('README.md contents')
    expect(preview).toHaveTextContent('# Friday')
    expect(preview).toHaveTextContent('Read-only workspace.')
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('shows safe empty and unavailable states', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })))
    const { rerender } = render(<RepositoriesWorkspace />)
    expect(await screen.findByText(/No repositories are registered/)).toBeInTheDocument()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })))
    rerender(<RepositoriesWorkspace key="unavailable" />)
    expect(await screen.findByText(/Repository registry unavailable/)).toBeInTheDocument()
  })

  it('keeps the file list available after a file read is rejected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/repositories') return new Response(JSON.stringify([{ id: 'friday', name: 'Friday', defaultBranch: 'main', mode: 'read-only', enabled: true }]))
      if (url.endsWith('/status')) return new Response(JSON.stringify({ branch: 'main', dirty: false }))
      if (url.includes('/files?')) return new Response(JSON.stringify(['README.md', 'src/index.ts']))
      if (url.includes('README.md')) return new Response(JSON.stringify({ error: 'rejected' }), { status: 400 })
      return new Response(JSON.stringify({ path: 'src/index.ts', content: 'safe source' }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<RepositoriesWorkspace />)

    await user.click(await screen.findByRole('button', { name: 'README.md' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This file cannot be read.')
    await user.click(screen.getByRole('button', { name: 'src/index.ts' }))
    expect(await screen.findByLabelText('src/index.ts contents')).toHaveTextContent('safe source')
  })
})
