import test from 'node:test'
import assert from 'node:assert/strict'
import {checkAnonymousAccess,routes} from './check-friday-edge-readiness.mjs'

const team='mytechtactics.cloudflareaccess.com'
const login='https://'+team+'/cdn-cgi/access/login?token=do-not-print'
test('preflight checks HTML, asset entry, APIs and health as GET-only without auth material',async()=>{
 const called=[]
 const result=await checkAnonymousAccess({
  fetchImpl:async(url,options)=>{
   called.push({url,method:options.method,redirect:options.redirect,headers:options.headers})
   return new Response(null,{status:403})
  }
 })
 assert.equal(result.safe,true)
 assert.deepEqual(result.results.map(r=>r.path),routes)
 assert.equal(routes.length,6)
 assert.ok(called.every(c=>c.method==='GET'&&c.redirect==='manual'))
 assert.ok(called.every(c=>!Object.keys(c.headers).some(k=>/cookie|authorization|jwt/i.test(k))))
})
test('anonymous public 200 on even one protected route fails the entire probe',async()=>{
 let n=0
 const r=await checkAnonymousAccess({fetchImpl:async()=>{
  ++n
  return new Response(null,{status:n===4?200:403})
 }})
 assert.equal(r.safe,false)
 assert.equal(r.results[3].closed,false)
})
test('accepts ONLY matching Cloudflare team sign-in redirect, 401 or 403',async()=>{
 const statuses=[302,401,403,302,401,403]
 let count=0
 const result=await checkAnonymousAccess({fetchImpl:async()=>new Response(null,{
  status:statuses[count++],headers:{location:login,'set-cookie':'session=secret'},
 })})
 assert.equal(result.safe,true)
 assert.equal(count,6)
 assert.ok(result.results.every(r=>!('location'in r)&&!('cookie'in r)&&!('body'in r)))
})
test('rejects misleading redirects and unrelated Cloudflare teams, even with /cdn-cgi/access path',async()=>{
 for(const destination of [
  'https://unrelated.cloudflareaccess.com/cdn-cgi/access/login',
  'https://mytechtactics.cloudflareaccess.com.attacker.test/cdn-cgi/access/login',
  'http://mytechtactics.cloudflareaccess.com/cdn-cgi/access/login',
  'https://mytechtactics.cloudflareaccess.com/welcome',
  'https://mytechtactics.com/login',
  '/cdn-cgi/access/login',
 ]){
  const res=await checkAnonymousAccess({fetchImpl:async()=>new Response(null,{
   status:302,headers:{location:destination},
  })})
  assert.equal(res.safe,false,destination)
 }
})
test('network errors, 404, 429 and 503 never count as proof of protection',async()=>{
 for(const status of [404,429,503]){
  const res=await checkAnonymousAccess({fetchImpl:async()=>new Response(null,{status})})
  assert.equal(res.safe,false,String(status))
 }
 const unavailable=await checkAnonymousAccess({fetchImpl:async()=>{throw Error('offline')}})
 assert.equal(unavailable.safe,false)
 assert.equal(unavailable.results[0].reason,'network-error')
})
test('rejects insecure URLs, credentials, unexpected paths/ports and untrusted team hostname',async()=>{
 for(const origin of ['http://example.com','https://user:password@example.com/','https://example.com:444/','https://example.com/query','https://example.com/?code=1']){
  await assert.rejects(checkAnonymousAccess({origin,fetchImpl:async()=>new Response(null,{status:403})}))
 }
 for(const expectedTeamHost of ['example.com','https://mytechtactics.cloudflareaccess.com','team.cloudflareaccess.com.attacker.test','']){
  await assert.rejects(checkAnonymousAccess({expectedTeamHost,fetchImpl:async()=>new Response(null,{status:403})}))
 }
})
