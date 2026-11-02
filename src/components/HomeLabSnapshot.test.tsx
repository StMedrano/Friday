import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import HomeLabSnapshot from './HomeLabSnapshot'

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
const snapshot={mode:'live',generatedAt:'2026-10-14T20:00:00Z',services:[{id:'vm100',name:'VM 100',host:'ubuntu-docker',status:'degraded',detail:'Observed warning'}],incidents:[{id:'i1',title:'Service warning',detail:'Observed failure',status:'open',severity:'warning'}]}
afterEach(()=>vi.unstubAllGlobals())

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


it('keeps showing observations when the overview carries a long history of resolved incidents',async()=>{
 const resolved=Array.from({length:1500},(_,i)=>({id:'r'+i,title:'Old',detail:'Recovered',status:'resolved',severity:'info'}))
 vi.stubGlobal('fetch',vi.fn(async()=>json({...snapshot,incidents:[...resolved,...snapshot.incidents]})))
 render(<HomeLabSnapshot/>)
 expect(await screen.findByText('VM 100')).toBeInTheDocument()
 expect(screen.getByText('Service warning')).toBeInTheDocument()
})
