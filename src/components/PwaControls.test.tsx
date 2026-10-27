import {act,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import PwaControls from './PwaControls'

describe('PWA install controls',()=>{
 beforeEach(()=>{
  Object.defineProperty(navigator,'onLine',{configurable:true,value:true})
  Object.defineProperty(window,'matchMedia',{configurable:true,
   value:()=>({matches:false,addListener:vi.fn(),removeListener:vi.fn()})})
 })
 afterEach(()=>vi.restoreAllMocks())
 it('offers a real browser install prompt only after beforeinstallprompt is available',async()=>{
  const prompt=vi.fn().mockResolvedValue(undefined)
  render(<PwaControls/>)
  expect(screen.queryByRole('button',{name:'Install FRIDAY'})).not.toBeInTheDocument()
  const event=new Event('beforeinstallprompt',{cancelable:true}) as Event & {
   prompt:()=>Promise<void>
   userChoice:Promise<{outcome:string}>
  }
  event.prompt=prompt
  event.userChoice=Promise.resolve({outcome:'accepted'})
  act(()=>window.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'Install FRIDAY'}))
  await waitFor(()=>expect(prompt).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button',{name:'Install FRIDAY'})).not.toBeInTheDocument()
 })
 it('shows disconnected operational state without falsely claiming API availability',()=>{
  render(<PwaControls/>)
  act(()=>{
   Object.defineProperty(navigator,'onLine',{configurable:true,value:false})
   window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('status')).toHaveTextContent('Offline')
  act(()=>{
   Object.defineProperty(navigator,'onLine',{configurable:true,value:true})
   window.dispatchEvent(new Event('online'))
  })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
 })
 it('never prompts once the app is in standalone mode',()=>{
  Object.defineProperty(window,'matchMedia',{configurable:true,
   value:()=>({matches:true,addListener:vi.fn(),removeListener:vi.fn()})})
  render(<PwaControls/>)
  const event=new Event('beforeinstallprompt',{cancelable:true})
  act(()=>window.dispatchEvent(event))
  expect(screen.queryByRole('button',{name:'Install FRIDAY'})).not.toBeInTheDocument()
 })
})
