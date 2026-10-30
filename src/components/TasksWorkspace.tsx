import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { fetchProjectTasks, FridayWorkError, type FridayTask } from '../lib/api'

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

function failureMessage(reason: unknown) {
  if (reason instanceof FridayWorkError) {
    if (reason.status === 404) return 'Project tasks are not enabled on this controller.'
    if (reason.status === 403) return 'Your signed-in account has no access to this project.'
  }
  return 'Project tasks are unavailable.'
}

export default function TasksWorkspace() {
  const [projectId, setProjectId] = useState(PROJECTS[0].id)
  const [tasks, setTasks] = useState<FridayTask[] | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setTasks(null)
    setMessage('')
    fetchProjectTasks(projectId, controller.signal)
      .then(setTasks)
      .catch((reason) => { if (reason?.name !== 'AbortError') setMessage(failureMessage(reason)) })
    return () => controller.abort()
  }, [projectId])

  const project = PROJECTS.find((item) => item.id === projectId)
  return <section className="v3-tasks-workspace" aria-label="Project tasks workspace">
    <div className="v3-detail-hero">
      <div className="v3-node-icon large"><CheckCircle2/></div>
      <div><span className="v3-kicker">PROJECT WORK</span><h2>Tasks</h2>
        <p>Read-only project tasks from Friday's work database. Nothing on this screen creates, claims or changes a task.</p></div>
    </div>

    <div className="v3-settings-form">
      <label htmlFor="v3-task-project">Project
        <select id="v3-task-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {PROJECTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>

    {message ? <p role="status" className="v3-settings-message">{message}</p>
      : !tasks ? <p role="status" className="v3-settings-message">Loading tasks…</p>
        : tasks.length === 0 ? <p role="status" className="v3-settings-message">No tasks recorded for {project?.name} yet.</p>
          : <ul className="v3-settings-list" aria-label={`${project?.name} tasks`}>
            {tasks.map((task) => <li key={task.id}>
              <span className="v3-settings-name"><b>{task.title}</b><small>{task.id} · version {task.version}</small></span>
              <span className={`v3-settings-pill ${task.status === 'completed' ? 'on' : task.status === 'blocked' ? 'warn' : 'off'}`}>{STATUS_LABELS[task.status]}</span>
            </li>)}
          </ul>}
  </section>
}
