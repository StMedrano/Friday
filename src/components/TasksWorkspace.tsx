import NotConnected from './NotConnected'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { createProjectTask, fetchProjectTasks, FridayWorkError, type FridayTask } from '../lib/api'

const PROJECTS = [
  { id: 'friday-ai-os', name: 'Friday AI OS' },
  { id: 'techtactics', name: 'TechTactics' },
  { id: 'web-growth-agents', name: 'Web Growth Agents' },
  { id: 'app-builder', name: 'App Builder' },
]
const STATUS_LABELS: Record<FridayTask['status'], string> = {
  ready: 'Ready', in_progress: 'In progress', blocked: 'Blocked',
  review: 'In review', completed: 'Completed', cancelled: 'Cancelled',
}
const TITLE_MAX = 160
const DETAIL_MAX = 4000

function failureMessage(reason: unknown) {
  if (reason instanceof FridayWorkError) {
    if (reason.status === 404) return 'Project tasks are not enabled on this controller.'
    if (reason.status === 403) return 'Your signed-in account has no access to this project.'
  }
  return 'Project tasks are unavailable.'
}

function createFailure(reason: unknown) {
  if (reason instanceof FridayWorkError) {
    if (reason.status === 403) return 'Only an operator with access to this project can add tasks.'
    if (reason.status === 400) return 'Check the title: it is required and up to 160 characters, with no secrets.'
    if (reason.status === 404) return 'Adding tasks is switched off on this controller.'
    if (reason.code === 'audit-unavailable') return 'The action audit could not record this, so the task was not added.'
  }
  return 'The task could not be added. Try again.'
}

function newRequestId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export default function TasksWorkspace() {
  const [projectId, setProjectId] = useState(PROJECTS[0].id)
  const [tasks, setTasks] = useState<FridayTask[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [message, setMessage] = useState('')
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  // One id per draft, so a retry after a dropped response never adds a second task.
  const requestId = useRef(newRequestId())
  const selectedProject = useRef(projectId)
  selectedProject.current = projectId

  useEffect(() => {
    const controller = new AbortController()
    setTasks(null)
    setMessage('')
    setNotice('')
    fetchProjectTasks(projectId, controller.signal)
      .then((board) => { setTasks(board.tasks); setCanCreate(board.canCreate) })
      .catch((reason) => { if (reason?.name !== 'AbortError') { setCanCreate(false); setMessage(failureMessage(reason)) } })
    return () => controller.abort()
  }, [projectId])

  const project = PROJECTS.find((item) => item.id === projectId)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || saving) return
    const submittedProject = projectId
    const submittedName = project?.name
    setSaving(true)
    setNotice('')
    try {
      const task = await createProjectTask({
        projectId: submittedProject, title: trimmed, requestId: requestId.current,
        ...(detail.trim() ? { objective: detail.trim() } : {}),
      })
      // Only show it if that project is still the one on screen.
      if (selectedProject.current === submittedProject && task.projectId === submittedProject)
        setTasks((current) => [task, ...(current || []).filter((item) => item.id !== task.id)])
      setTitle('')
      setDetail('')
      requestId.current = newRequestId()
      setNotice(`Added “${task.title}” to ${submittedName}. It is ready; nothing was started.`)
    } catch (reason) {
      if (reason instanceof FridayWorkError && reason.status === 409) requestId.current = newRequestId()
      setNotice(createFailure(reason))
    } finally {
      setSaving(false)
    }
  }

  return <section className="v3-tasks-workspace" aria-label="Project tasks workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><CheckCircle2/></div>
      <div><span className="v3-kicker">PROJECT WORK</span><h2>Tasks</h2>
        <p>{canCreate
          ? 'Project tasks from Friday’s work database. Operators can add a task; nothing here claims, moves or runs one.'
          : 'Read-only project tasks from Friday’s work database. Nothing on this screen creates, claims or changes a task.'}</p></div>
    </div>

    <div className="v3-settings-form">
      <label htmlFor="v3-task-project">Project
        <select id="v3-task-project" value={projectId} disabled={saving} onChange={(event) => setProjectId(event.target.value)}>
          {PROJECTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>

    {canCreate
      ? <form className="v3-settings-form fx-task-create" aria-label="New task" onSubmit={(event) => void submit(event)}>
        <label htmlFor="v3-task-title">New task
          <input id="v3-task-title" value={title} maxLength={TITLE_MAX} required placeholder="What needs doing?"
            onChange={(event) => { setTitle(event.target.value); requestId.current = newRequestId() }}/>
        </label>
        <label htmlFor="v3-task-detail">Details (optional)
          <input id="v3-task-detail" value={detail} maxLength={DETAIL_MAX} placeholder="Goal or notes"
            onChange={(event) => { setDetail(event.target.value); requestId.current = newRequestId() }}/>
        </label>
        <button type="submit" disabled={saving || !title.trim()}>{saving ? 'Adding…' : 'Add task'}</button>
      </form>
      : <NotConnected title="New tasks" detail="Adding tasks is off on this controller (FRIDAY_WORK_WRITE_ENABLED). Claiming and moving tasks are not built."/>}
    {notice && <p role="status" className="v3-settings-message">{notice}</p>}

    {message ? <p role="status" className="v3-settings-message">{message}</p>
      : !tasks ? <p role="status" className="v3-settings-message">Loading tasks…</p>
        : tasks.length === 0 ? <p role="status" className="v3-settings-message">No tasks recorded for {project?.name} yet.</p>
          : <ul className="v3-settings-list fx-task-board" aria-label={`${project?.name} tasks`}>
            {tasks.map((task) => <li key={task.id}>
              <span className="v3-settings-name"><b>{task.title}</b><small>{task.id} · version {task.version}</small></span>
              <span className={`v3-settings-pill ${task.status === 'completed' ? 'on' : task.status === 'blocked' ? 'warn' : 'off'}`}>{STATUS_LABELS[task.status]}</span>
            </li>)}
          </ul>}
  </section>
}
