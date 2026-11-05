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

  it('shows open pull requests, CI and the last commit from the GitHub read integration', async () => {
    const summary = {
      repository: 'StMedrano/Friday', url: 'https://github.com/StMedrano/Friday', branch: 'main', fetchedAt: '2026-11-05T18:00:00.000Z',
      pullRequests: { open: 3, more: false, items: [
        { number: 123, title: 'Add an AIDesigner API', author: 'StMedrano', draft: false, updatedAt: '2026-11-05T16:00:00Z', url: 'https://github.com/StMedrano/Friday/pull/123' },
        { number: 122, title: 'Port docs', author: 'bot', draft: true, updatedAt: '2026-11-04T16:00:00Z' },
      ] },
      ci: { state: 'failure', total: 4, failed: 1, pending: 0 },
      lastCommit: { sha: '3a21f9d', message: 'Match the remaining pages (#126)', author: 'Stalin', date: '2026-11-05T17:00:00Z', url: 'https://github.com/StMedrano/Friday/commit/3a21f9d' },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input)
      if (url === '/api/repositories') return new Response(JSON.stringify([
        { id: 'friday', name: 'Friday', remote: 'https://github.com/StMedrano/Friday.git', defaultBranch: 'main', mode: 'read-only', enabled: true },
        { id: 'local', name: 'Local only', defaultBranch: 'main', mode: 'read-only', enabled: true },
      ]))
      if (url === '/api/repositories/friday/github') return new Response(JSON.stringify(summary))
      if (url === '/api/repositories/local/github') return new Response(JSON.stringify({ error: 'github-remote-unsupported' }), { status: 404 })
      if (url.endsWith('/status')) return new Response(JSON.stringify({ branch: 'main', dirty: false }))
      return new Response(JSON.stringify([]))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<RepositoriesWorkspace />)

    const row = (await screen.findByText('Local only')).closest('tr') as HTMLElement
    expect(await screen.findByText('1 failing')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('3a21f9d')).toBeInTheDocument()
    expect(row).toHaveTextContent('Not on GitHub')
    const panel = screen.getByRole('region', { name: 'Open pull requests' })
    expect(panel).toHaveTextContent('#123')
    expect(panel).toHaveTextContent('Draft')
    expect(screen.getByRole('link', { name: /Add an AIDesigner API/ })).toHaveAttribute('href', 'https://github.com/StMedrano/Friday/pull/123')
    expect(screen.getByRole('link', { name: /Add an AIDesigner API/ })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('note', { name: 'Pull requests and CI: not connected' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true)
  })

  it('keeps the not connected state when the server has no GitHub integration', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/repositories') return new Response(JSON.stringify([{ id: 'friday', name: 'Friday', defaultBranch: 'main', mode: 'read-only', enabled: true }]))
      if (url.endsWith('/github')) return new Response(JSON.stringify({ error: 'github-disabled' }), { status: 503 })
      if (url.endsWith('/status')) return new Response(JSON.stringify({ branch: 'main', dirty: false }))
      return new Response(JSON.stringify([]))
    }))
    render(<RepositoriesWorkspace />)
    expect(await screen.findByRole('note', { name: 'Pull requests and CI: not connected' })).toBeInTheDocument()
    expect(screen.getByTitle('CI status is not connected')).toHaveTextContent('Not connected')
  })
})
