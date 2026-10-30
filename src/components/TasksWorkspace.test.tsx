import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TasksWorkspace from './TasksWorkspace'

afterEach(() => vi.unstubAllGlobals())

const tasks = [
  { id: 'task-1', projectId: 'friday-ai-os', title: 'Wire the work bridge', status: 'ready', version: 1 },
  { id: 'task-2', projectId: 'friday-ai-os', title: 'Review the rollout', status: 'blocked', version: 3 },
]

describe('TasksWorkspace', () => {
  it('lists a project’s tasks read-only with no action controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tasks }), { status: 200 })))
    render(<TasksWorkspace />)
    const list = await screen.findByRole('list', { name: 'Friday AI OS tasks' })
    expect(within(list).getByText('Wire the work bridge').closest('li')).toHaveTextContent('Ready')
    expect(within(list).getByText('Review the rollout').closest('li')).toHaveTextContent('Blocked')
    expect(screen.getByText(/Nothing on this screen creates, claims or changes a task/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('requests the selected project', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => new Response(JSON.stringify({ tasks: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TasksWorkspace />)
    expect(await screen.findByText(/No tasks recorded for Friday AI OS yet/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'app-builder' } })
    expect(await screen.findByText(/No tasks recorded for App Builder yet/)).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0][0])).toContain('projectId=friday-ai-os')
    expect(String(fetchMock.mock.calls[1][0])).toContain('projectId=app-builder')
    expect(fetchMock.mock.calls.every(([, options]) => !options || !options.method || options.method === 'GET')).toBe(true)
  })

  it('says when tasks are switched off rather than showing an empty project', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not-found' }), { status: 404 })))
    render(<TasksWorkspace />)
    expect(await screen.findByText('Project tasks are not enabled on this controller.')).toBeInTheDocument()
  })

  it('explains a denied project instead of showing another person’s work', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'work-read-denied' }), { status: 403 })))
    render(<TasksWorkspace />)
    expect(await screen.findByText('Your signed-in account has no access to this project.')).toBeInTheDocument()
  })

  it('rejects a malformed task payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tasks: [{ id: 'x' }] }), { status: 200 })))
    render(<TasksWorkspace />)
    expect(await screen.findByText('Project tasks are unavailable.')).toBeInTheDocument()
  })
})
