import {render,screen,waitFor} from '@testing-library/react'
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
