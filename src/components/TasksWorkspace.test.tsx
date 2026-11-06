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

  it('offers New task only when the controller allows it, and adds the created task', async () => {
    const created = { id: 'task-9', projectId: 'friday-ai-os', title: 'Write release notes', status: 'ready', version: 1 }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ task: created }), { status: 201 })
      : new Response(JSON.stringify({ tasks, canCreate: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TasksWorkspace />)
    const form = await screen.findByRole('form', { name: 'New task' })
    const add = within(form).getByRole('button', { name: 'Add task' })
    expect(add).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('New task'), { target: { value: '  Write release notes ' } })
    fireEvent.change(within(form).getByLabelText('Details (optional)'), { target: { value: 'For the next deploy' } })
    fireEvent.click(add)
    expect(await screen.findByText(/Added “Write release notes” to Friday AI OS/)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Friday AI OS tasks' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Write release notes')
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(String(post[0])).toBe('/api/work/tasks')
    const body = JSON.parse(String(post[1]?.body))
    expect(body).toMatchObject({ projectId: 'friday-ai-os', title: 'Write release notes', objective: 'For the next deploy' })
    expect(typeof body.requestId).toBe('string')
    expect(within(form).getByLabelText('New task')).toHaveValue('')
  })

  it('keeps New task hidden when the controller does not allow it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ tasks }), { status: 200 })))
    render(<TasksWorkspace />)
    await screen.findByRole('list', { name: 'Friday AI OS tasks' })
    expect(screen.queryByRole('form', { name: 'New task' })).not.toBeInTheDocument()
    expect(screen.getByText(/FRIDAY_WORK_WRITE_ENABLED/)).toBeInTheDocument()
  })

  it('explains a denied create without losing the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'work-write-denied' }), { status: 403 })
      : new Response(JSON.stringify({ tasks: [], canCreate: true }), { status: 200 })))
    render(<TasksWorkspace />)
    const form = await screen.findByRole('form', { name: 'New task' })
    fireEvent.change(within(form).getByLabelText('New task'), { target: { value: 'Draft' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add task' }))
    expect(await screen.findByText('Only an operator with access to this project can add tasks.')).toBeInTheDocument()
    expect(within(form).getByLabelText('New task')).toHaveValue('Draft')
  })

  it('does not show a task under another project if the selection changed while saving', async () => {
    let finish: (value: Response) => void = () => {}
    const created = { id: 'task-9', projectId: 'friday-ai-os', title: 'Slow one', status: 'ready', version: 1 }
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'POST'
      ? new Promise<Response>((resolve) => { finish = resolve })
      : Promise.resolve(new Response(JSON.stringify({ tasks: [], canCreate: true }), { status: 200 }))))
    const { rerender } = render(<TasksWorkspace />)
    const form = await screen.findByRole('form', { name: 'New task' })
    fireEvent.change(within(form).getByLabelText('New task'), { target: { value: 'Slow one' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Project')).toBeDisabled()
    rerender(<TasksWorkspace />)
    finish(new Response(JSON.stringify({ task: created }), { status: 201 }))
    expect(await screen.findByText(/Added “Slow one” to Friday AI OS/)).toBeInTheDocument()
    expect(screen.getByLabelText('Project')).not.toBeDisabled()
  })
})
