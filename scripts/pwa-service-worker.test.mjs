import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'
const code=await readFile(new URL('../public/sw.js',import.meta.url),'utf8')
function worker(fetchImpl,cacheFailure={}){
 const handlers={},put=[],deleted=[],store=new Map(),requests=[]
 const scope={
  location:{origin:'https://friday.example'},
  addEventListener:(name,fn)=>{handlers[name]=fn},
  clients:{claim:async()=>{}},
  skipWaiting:()=>{},
 }
 const caches={
  keys:async()=>[...store.keys()],
  delete:async key=>{deleted.push(key);return store.delete(key)},
  open:async key=>{
   if(cacheFailure.open)throw Error('cache open failed')
   if(!store.has(key))store.set(key,new Map())
   const bucket=store.get(key)
   return {
    match:async req=>{
     if(cacheFailure.match)throw Error('cache match failed')
     return bucket.get(typeof req==='string'?req:req.url)||undefined
    },
    put:async(req,response)=>{
     if(cacheFailure.put)throw Error('cache put failed')
     put.push(req.url);bucket.set(req.url,response)
    },
   }
  },
 }
 runInNewContext(code,{self:scope,caches,URL,Response,Promise,fetch:async request=>{
  requests.push(request.url);return fetchImpl(request)
 }})
 const dispatch=(name,payload)=>{
  let pending
  handlers[name]({...payload,respondWith:promise=>{pending=promise},
   waitUntil:promise=>{pending=promise}})
  return pending
 }
 const req=(path,mode='cors',method='GET')=>({
  url:'https://friday.example'+path,mode,method,headers:new Headers(),
 })
 return {scope,handlers,dispatch,req,requests,put,deleted,store}
}
test('never intercept or cache private operational routes, auth pages, mutation requests or cross-origin',()=>{
 const w=worker(async()=>new Response('ignored'))
 for(const path of ['/api/overview','/api/work/tasks?projectId=a',
  '/cdn-cgi/access/login','/oauth/callback','/auth/login','/login']){
  const pending=w.dispatch('fetch',{request:w.req(path,'navigate')})
  assert.equal(pending,undefined,path)
 }
 assert.equal(w.dispatch('fetch',{request:w.req('/assets/index-a1b2c3d4.js','cors','POST')}),undefined)
 assert.equal(w.dispatch('fetch',{request:{...w.req('/assets/index-a1b2c3d4.js'),
  url:'https://third-party.example/assets/index-a1b2c3d4.js'}}),undefined)
 assert.equal(w.requests.length,0)
 assert.deepEqual(w.put,[])
})
test('offline navigation yields generic offline-only page rather than caching authenticated HTML',async()=>{
 const w=worker(async()=>{throw Error('network offline')})
 const result=await w.dispatch('fetch',{request:w.req('/','navigate')})
 assert.equal(result.status,503)
 assert.match(await result.text(),/You are offline/)
 assert.equal(result.headers.get('cache-control'),'no-store')
 assert.deepEqual(w.put,[])
})
test('online navigation always uses network; never caches a private page',async()=>{
 const w=worker(async()=>new Response('<html>PRIVATE OPERATOR SESSION</html>',{
  headers:{'content-type':'text/html','set-cookie':'private=1'}}))
 const result=await w.dispatch('fetch',{request:w.req('/','navigate')})
 assert.match(await result.text(),/PRIVATE OPERATOR SESSION/)
 assert.equal(w.put.length,0)
})
test('only same-origin hashed CSS/JS assets with valid MIME and no auth redirects are cacheable',async()=>{
 let count=0
 const w=worker(async request=>{
  count++
  if(request.url.includes('bad'))return new Response('<html>Login</html>',{headers:{'content-type':'text/html'}})
  if(request.url.includes('cookie'))return new Response('fake', {headers:{
   'content-type':'application/javascript','set-cookie':'session=123'}})
  return new Response('export const x = 1', {
   headers:{'content-type':'application/javascript'}})
 })
 const req=w.req('/assets/index-a1b2c3d4.js')
 assert.equal((await w.dispatch('fetch',{request:req})).status,200)
 assert.equal((await w.dispatch('fetch',{request:req})).status,200)
 assert.equal(count,1)
 assert.equal(w.put.length,1)
 assert.equal(w.dispatch('fetch',{request:w.req('/config.js')}),undefined)
 const bad=await w.dispatch('fetch',{request:w.req('/assets/bad-a1b2c3d4.js')})
 assert.equal(bad.status,200)
 await w.dispatch('fetch',{request:w.req('/assets/cookie-a1b2c3d4.js')})
 assert.equal(w.put.length,1)
})
test('cache storage open and lookup failures fall back to the online asset response',async()=>{
 for(const failure of [{open:true},{match:true}]){
  const w=worker(async()=>new Response('online asset',{
   headers:{'content-type':'application/javascript'},
  }),failure)
  const result=await w.dispatch('fetch',{
   request:w.req('/assets/index-a1b2c3d4.js'),
  })
  assert.equal(result.status,200)
  assert.equal(await result.text(),'online asset')
  assert.equal(w.requests.length,1)
 }
})
test('cache storage write failure does not discard a successful online asset response',async()=>{
 const w=worker(async()=>new Response('online asset',{
  headers:{'content-type':'application/javascript'},
 }),{put:true})
 const result=await w.dispatch('fetch',{
  request:w.req('/assets/index-a1b2c3d4.js'),
 })
 assert.equal(result.status,200)
 assert.equal(await result.text(),'online asset')
 assert.equal(w.requests.length,1)
})
