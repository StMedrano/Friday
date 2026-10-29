import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import GroupAdvisory from './GroupAdvisory'
import HomeLabSnapshot from './HomeLabSnapshot'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const reply={available:true,groupId:'app-builder',text:'Proposed build plan: define requirements, implement, then verify.',mode:'cloud-ai',provider:'fixture',model:'test-model',execution:{performed:false,reason:'Advisory only'}}
const snapshot={mode:'live',generatedAt:'2026-10-14T20:00:00Z',services:[{id:'vm100',name:'VM 100',host:'ubuntu-docker',status:'degraded',detail:'Observed warning'}],incidents:[{id:'i1',title:'Service warning',detail:'Observed failure',status:'open',severity:'warning'}]}
afterEach(()=>vi.unstubAllGlobals())

it('requests a group-specific proposal once and shows provenance without claiming worker execution',async()=>{
 const fetchMock=vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit)=>json(reply))
 vi.stubGlobal('fetch',fetchMock)
 const user=userEvent.setup()
 render(<GroupAdvisory groupId="app-builder" groupName="App Builder"/>)
 expect(fetchMock).not.toHaveBeenCalled()
 expect(screen.getByRole('button',{name:'Generate proposal'})).toBeDisabled()
 await user.type(screen.getByLabelText('Describe the task'),'Build a booking app')
 await user.click(screen.getByRole('button',{name:'Generate proposal'}))
 expect(await screen.findByText(reply.text)).toBeInTheDocument()
 expect(screen.getByText('fixture · test-model')).toBeInTheDocument()
 expect(screen.getByText(/not a running specialist/i)).toBeInTheDocument()
 expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({groupId:'app-builder',prompt:'Build a booking app'})
 expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('keeps the brief after failure and allows an explicit retry',async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(json({reason:'Unavailable'},503)).mockResolvedValueOnce(json(reply))
 vi.stubGlobal('fetch',fetchMock)
 const user=userEvent.setup()
 render(<GroupAdvisory groupId="app-builder" groupName="App Builder"/>)
 await user.type(screen.getByLabelText('Describe the task'),'Plan a small app')
 await user.click(screen.getByRole('button',{name:'Generate proposal'}))
 expect(await screen.findByText(/Group advice unavailable/i)).toBeInTheDocument()
 expect(screen.getByLabelText('Describe the task')).toHaveValue('Plan a small app')
 await user.click(screen.getByRole('button',{name:'Generate proposal'}))
 expect(await screen.findByText(reply.text)).toBeInTheDocument()
})

it('rejects a result that claims execution or belongs to a different group',async()=>{
 for(const invalid of [{...reply,groupId:'homelab'},{...reply,execution:{performed:true}},{...reply,mode:'local-analysis'},{...reply,fallbackUsed:true,attempts:{}},{...reply,fallbackUsed:'yes'}]){
  vi.stubGlobal('fetch',vi.fn(async()=>json(invalid)))
  const {unmount}=render(<GroupAdvisory groupId="app-builder" groupName="App Builder"/>)
  fireEvent.change(screen.getByLabelText('Describe the task'),{target:{value:'Plan'}})
  fireEvent.click(screen.getByRole('button',{name:'Generate proposal'}))
  expect(await screen.findByText(/Group advice unavailable/i)).toBeInTheDocument()
  expect(screen.queryByText(reply.text)).not.toBeInTheDocument()
  unmount()
 }
})

it('aborts waiting on unmount and ignores a late response',async()=>{
 let resolve!:(response:Response)=>void
 let signal:AbortSignal|undefined
 vi.stubGlobal('fetch',vi.fn((_url,init)=>{signal=init.signal;return new Promise<Response>(done=>{resolve=done})}))
 const {unmount}=render(<GroupAdvisory groupId="app-builder" groupName="App Builder"/>)
 fireEvent.change(screen.getByLabelText('Describe the task'),{target:{value:'Plan'}})
 fireEvent.click(screen.getByRole('button',{name:'Generate proposal'}))
 unmount()
 expect(signal?.aborted).toBe(true)
 await act(async()=>{resolve(json(reply));await Promise.resolve()})
 expect(screen.queryByText(reply.text)).not.toBeInTheDocument()
})

it('shows current HomeLab evidence with refresh and marks failed refresh as unavailable',async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(json(snapshot)).mockResolvedValueOnce(json({},503))
 vi.stubGlobal('fetch',fetchMock)
 render(<HomeLabSnapshot/>)
 expect(await screen.findByText('VM 100')).toBeInTheDocument()
 expect(screen.getByText('Service warning')).toBeInTheDocument()
 expect(screen.getByRole('region', {name:'Observed services'})).toHaveAttribute('tabindex','0')
 expect(screen.getByText(/Live observations/)).toBeInTheDocument()
 expect(screen.queryByRole('button',{name:/restart|approve|execute/i})).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Refresh observations'}))
 expect(await screen.findByText('HomeLab observations unavailable')).toBeInTheDocument()
 expect(screen.queryByText('VM 100')).not.toBeInTheDocument()
 expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('labels mock evidence and rejects malformed live evidence without a fake healthy state',async()=>{
 for(const [body,label] of [[{...snapshot,mode:'mock'},'Demo data · not live'],[{mode:'live',services:[{name:'Made up'}],incidents:[]},'HomeLab observations unavailable']] as const){
  vi.stubGlobal('fetch',vi.fn(async()=>json(body)))
  const {unmount}=render(<HomeLabSnapshot/>)
  expect(await screen.findByText(label)).toBeInTheDocument()
  unmount()
 }
})

it('aborts the HomeLab read when leaving the group',async()=>{
 let signal:AbortSignal|undefined
 vi.stubGlobal('fetch',vi.fn((_url,init)=>{signal=init.signal;return new Promise(()=>{})}))
 const {unmount}=render(<HomeLabSnapshot/>)
 await waitFor(()=>expect(signal).toBeDefined())
 unmount()
 expect(signal?.aborted).toBe(true)
})
