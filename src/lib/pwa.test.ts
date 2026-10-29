import {describe,it,expect,vi} from 'vitest'
import {registerFridayPwa} from './pwa'

describe('secure production PWA registration',()=>{
 it('does not register during development or on an insecure origin',async()=>{
  const register=vi.fn()
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register}})
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:true})
  expect(await registerFridayPwa({production:false})).toBe(false)
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:false})
  expect(await registerFridayPwa({production:true})).toBe(false)
  expect(register).not.toHaveBeenCalled()
 })
 it('registers exactly the root service worker with cache bypass on HTTPS',async()=>{
  const register=vi.fn().mockResolvedValue({scope:'/'})
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register}})
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:true})
  expect(await registerFridayPwa({production:true})).toBe(true)
  expect(register).toHaveBeenCalledWith('/sw.js',{scope:'/',updateViaCache:'none'})
 })
 it('registration errors never prevent the existing Friday app from loading',async()=>{
  const register=vi.fn().mockRejectedValue(Error('Access unavailable'))
  Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{register}})
  Object.defineProperty(window,'isSecureContext',{configurable:true,value:true})
  expect(await registerFridayPwa({production:true})).toBe(false)
 })
})
