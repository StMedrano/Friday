import {useEffect,useRef,useState,type FormEvent} from 'react'
import {projectRequest,projectsFrom,tasksFrom,type Project,type ProjectTask} from '../lib/project-tasks'
import '../project-tasks.css'
export default function ProjectTasksWorkspace(){
 const [projects,setProjects]=useState<Project[]>([]),[project,setProject]=useState(''),[tasks,setTasks]=useState<ProjectTask[]>([])
 const [title,setTitle]=useState(''),[objective,setObjective]=useState(''),[criteria,setCriteria]=useState('')
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
 const requestId=useRef(''),pending=useRef<AbortController|null>(null)
 useEffect(()=>()=>pending.current?.abort(),[])
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');setTasks([])
  const operation=project?projectRequest(`/api/projects/${encodeURIComponent(project)}/tasks`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setTasks(tasksFrom(value,project))}):projectRequest('/api/projects',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setProjects(projectsFrom(value))})
  operation.catch(err=>{if(!controller.signal.aborted){setError(err instanceof Error?err.message:'Task storage unavailable');if(err?.message==='Project access denied'){setProjects([]);setProject('');setTitle('');setObjective('');setCriteria('')}}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[project,revision])
 async function submit(event:FormEvent){
  event.preventDefault();if(saving||loading||!project)return
  const controller=new AbortController();pending.current=controller;setSaving(true);setError('')
  requestId.current||=crypto.randomUUID()
  try{
   const result=await projectRequest(`/api/projects/${encodeURIComponent(project)}/tasks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,objective,acceptanceCriteria:criteria.split('\n').map(x=>x.trim()).filter(Boolean),requestId:requestId.current}),signal:controller.signal})
   const [saved]=tasksFrom({tasks:[result.task]},project)
   if(!controller.signal.aborted){setTasks(rows=>[saved,...rows.filter(x=>x.id!==saved.id)].slice(0,50));setTitle('');setObjective('');setCriteria('');requestId.current=''}
  }catch(err){if(!controller.signal.aborted){setError(err instanceof Error?err.message:'Task storage unavailable');if(err instanceof Error&&err.message==='Project access denied'){setProject('');setProjects([]);setTasks([])}}}
  finally{if(!controller.signal.aborted)setSaving(false)}
 }
 function edited(){requestId.current=''}
 return <section className="project-tasks" aria-label="Project tasks">
  <header><span className="v3-kicker">PROJECT WORK</span><h2>Project tasks</h2><p>Tasks are saved only after the server confirms storage. Creating a task does not run an agent.</p></header>
  <label>Project<select aria-label="Project" value={project} disabled={loading||saving} onChange={e=>{setProject(e.target.value);setTitle('');setObjective('');setCriteria('');edited()}}><option value="">Select a provisioned project</option>{projects.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
  <button type="button" disabled={loading||saving} onClick={()=>setRevision(x=>x+1)}>Refresh {project?'tasks':'projects'}</button>
  {loading&&<p role="status">Loading project records…</p>}
  {error&&<p role="alert">{error}</p>}
  {!loading&&!error&&!projects.length&&<p>No provisioned projects available.</p>}
  {project&&<><form onSubmit={submit}>
   <label>Task title<input required maxLength={160} value={title} disabled={saving} onChange={e=>{setTitle(e.target.value);edited()}}/></label>
   <label>Objective<textarea required maxLength={4000} value={objective} disabled={saving} onChange={e=>{setObjective(e.target.value);edited()}}/></label>
   <label>Acceptance criteria (one per line)<textarea maxLength={20000} value={criteria} disabled={saving} onChange={e=>{setCriteria(e.target.value);edited()}}/></label>
   <button disabled={saving||loading||!title.trim()||!objective.trim()}>{saving?'Saving task…':'Create task'}</button>
  </form>
  {!loading&&!error&&!tasks.length&&<p>No tasks recorded in this project.</p>}
  <div aria-label="Saved tasks">{tasks.map(row=><article key={row.id}><span>{row.status.replaceAll('_',' ')} · version {row.version}</span><h3>{row.title}</h3><p>{row.objective}</p>{row.acceptanceCriteria.length>0&&<ul>{row.acceptanceCriteria.map((criterion,index)=><li key={index}>{criterion}</li>)}</ul>}</article>)}</div></>}
 </section>
}
