import {fireEvent,render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {afterEach,expect,it,vi} from 'vitest'
import ProjectTasksWorkspace from './ProjectTasksWorkspace'
afterEach(()=>vi.unstubAllGlobals())
it('loads provisioned projects and saved tasks; failed writes retain draft without a false success',async()=>{
 let fail=false;let rows:unknown[]=[]
 vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
  if(path==='/api/projects')return {ok:true,json:async()=>({projects:[{id:'project-a',name:'Fixture project'}]})}
  if(options?.method==='POST'){
   if(fail)return {ok:false,status:503}
   const input=JSON.parse(options.body as string);const task={...input,id:'task-a',projectId:'project-a',status:'ready',version:1};rows=[task];return {ok:true,json:async()=>({task})}
  }
  return {ok:true,json:async()=>({tasks:rows})}
 }))
 const user=userEvent.setup();render(<ProjectTasksWorkspace/>);
 await screen.findByRole('option',{name:'Fixture project'})
 await user.selectOptions(screen.getByLabelText('Project'),'project-a')
 await screen.findByText('No tasks recorded in this project.')
 await user.type(screen.getByLabelText('Task title'),'Build fixture')
 await user.type(screen.getByLabelText('Objective'),'Verify persistence')
 await user.click(screen.getByRole('button',{name:'Create task'}))
 await screen.findByRole('heading',{name:'Build fixture'})
 fail=true;await user.type(screen.getByLabelText('Task title'),'Keep draft');await user.type(screen.getByLabelText('Objective'),'Failure case')
 await user.click(screen.getByRole('button',{name:'Create task'}))
 await screen.findByRole('alert');expect(screen.getByLabelText('Task title')).toHaveValue('Keep draft')
 expect(screen.queryByRole('heading',{name:'Keep draft'})).toBeNull()
})
it('unavailable and denied access do not masquerade as an empty project catalog',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:403})))
 render(<ProjectTasksWorkspace/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Project access denied'))
 expect(screen.queryByText('No provisioned projects available.')).toBeNull()
 expect(screen.queryByRole('button',{name:'Create task'})).toBeNull()
})

it('failed task reads disable creation until a successful explicit refresh',async()=>{
 let unavailable=true
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/api/projects'?{ok:true,json:async()=>({projects:[{id:'project-a',name:'Fixture project'}]})}:unavailable?{ok:false,status:503}:{ok:true,json:async()=>({tasks:[]})}))
 const user=userEvent.setup();render(<ProjectTasksWorkspace/>);
 await screen.findByRole('option',{name:'Fixture project'});await user.selectOptions(screen.getByLabelText('Project'),'project-a')
 await screen.findByRole('alert');await user.type(screen.getByLabelText('Task title'),'Draft');await user.type(screen.getByLabelText('Objective'),'Keep this draft')
 expect(screen.getByRole('button',{name:'Create task'})).toBeDisabled()
 fireEvent.submit(screen.getByRole('button',{name:'Create task'}).closest('form')!)
 expect(vi.mocked(fetch).mock.calls.every(([,options])=>options?.method!=='POST')).toBe(true)
 expect(screen.queryByText('No tasks recorded in this project.')).toBeNull()
 unavailable=false;await user.click(screen.getByRole('button',{name:'Refresh tasks'}))
 await screen.findByText('No tasks recorded in this project.')
 expect(screen.getByRole('button',{name:'Create task'})).toBeEnabled()
 expect(screen.getByLabelText('Task title')).toHaveValue('Draft')
})

it('an unchanged retry after a lost save response uses the same request ID',async()=>{
 const requests:string[]=[]
 vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
  if(path==='/api/projects')return {ok:true,json:async()=>({projects:[{id:'project-a',name:'Fixture project'}]})}
  if(options?.method==='POST'){
   const body=JSON.parse(options.body as string);requests.push(body.requestId)
   if(requests.length===1)throw Error('Response lost')
   return {ok:true,json:async()=>({task:{...body,id:'task-a',projectId:'project-a',status:'ready',version:1}})}
  }
  return {ok:true,json:async()=>({tasks:[]})}
 }))
 const user=userEvent.setup();render(<ProjectTasksWorkspace/>);
 await screen.findByRole('option',{name:'Fixture project'});await user.selectOptions(screen.getByLabelText('Project'),'project-a');await screen.findByText('No tasks recorded in this project.')
 await user.type(screen.getByLabelText('Task title'),'Retry task');await user.type(screen.getByLabelText('Objective'),'Avoid duplicates')
 await user.click(screen.getByRole('button',{name:'Create task'}));await screen.findByRole('alert')
 await user.click(screen.getByRole('button',{name:'Create task'}));await screen.findByRole('heading',{name:'Retry task'})
 expect(requests).toHaveLength(2);expect(requests[0]).toBeTruthy();expect(requests[1]).toBe(requests[0])
})
