import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {once} from 'node:events'
import {createLoginSites} from './login-sites.mjs'
import {createLoginSiteHttpHandler} from './login-sites-http.mjs'

const family='https://family.example.test'
const business='https://portal.example.test'
const identity={
 family:'https://family-login.example.test',
 techtactics:'https://business-login.example.test',
}
const appOrigins={family,techtactics:business}
function fixture(){
 const calls={family:[],techtactics:[]}
 const sites=createLoginSites({enabled:true,sites:['family','techtactics'].map(id=>({
  id,origin:appOrigins[id],identityOrigin:identity[id],
  browser:{
   async begin(args){
    calls[id].push(['begin',args])
    return {applicationId:id,authorizationUrl:identity[id]+'/application/o/authorize/?state=safe',
     setCookie:'__Host-friday-oidc-'+id+'=fixture; Path=/; Secure; HttpOnly; SameSite=Lax'}
   },
   async complete(args){
    calls[id].push(['complete',args])
    if(args.state!=='sample-state'||args.code!=='sample-code'||
       args.cookieHeader!=='__Host-friday-oidc-'+id+'=fixture')throw Error('PRIVATE_CALLBACK_ERROR')
    return {applicationId:id,state:'authenticated',setCookies:[
     '__Host-friday-oidc-'+id+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
     '__Host-friday-session-'+id+'=private-session; Path=/; Secure; HttpOnly; SameSite=Lax',
    ]}
   },
   async current(args){
    calls[id].push(['current',args])
    if(args.cookieHeader!=='__Host-friday-session-'+id+'=private-session')
     throw Error('PRIVATE_SESSION_ERROR')
    return {applicationId:id,csrfToken:'x'.repeat(43),identity:{kind:'human'}}
   },
   async logout(args){
    calls[id].push(['logout',args])
    if(args.cookieHeader!=='__Host-friday-session-'+id+'=private-session'||
      args.originHeader!==appOrigins[id]||args.csrfToken!=='x'.repeat(43))
      throw Error('PRIVATE_LOGOUT_ERROR')
    return {applicationId:id,state:'signed-out',setCookies:[
     '__Host-friday-oidc-'+id+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
     '__Host-friday-session-'+id+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
    ]}
   },
  },
 }))})
 return {sites,calls}
}
async function serve(t,handler){
 const server=createServer(handler)
 server.listen(0,'127.0.0.1')
 await once(server,'listening')
 t.after(async()=>{server.close();await once(server,'close')})
 return server.address().port
}
function call(port,{host=family.slice(8),method='GET',path='/login',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port,method,path,
   headers:{host,...headers}},async response=>{
    const data=[]
    for await(const part of response)data.push(part)
    resolve({status:response.statusCode,headers:response.headers,
     body:Buffer.concat(data).toString('utf8')})
   })
   req.on('error',reject)
   if(body!==undefined)req.write(body)
   req.end()
 })
}
const make=(f,id,enabled=true)=>createLoginSiteHttpHandler({
 enabled,applicationId:id,publicOrigin:appOrigins[id],sites:f.sites,
})

test('disabled HTTP bridge denies every login path without reaching site handlers',async t=>{
 const f=fixture()
 const port=await serve(t,make(f,'family',false))
 for(const path of ['/login','/auth/start','/auth/oidc/callback?state=x&code=y','/account','/auth/portal.css']){
  const response=await call(port,{path})
  assert.equal(response.status,503)
  assert.equal(response.headers['cache-control'],'no-store')
 }
 assert.deepEqual(f.calls.family,[])
})

test('actual isolated HTTP endpoints render two distinct branded public login pages',async t=>{
 const f=fixture()
 const familyPort=await serve(t,make(f,'family'))
 const businessPort=await serve(t,make(f,'techtactics'))
 const a=await call(familyPort)
 const b=await call(businessPort,{host:'portal.example.test'})
 assert.equal(a.status,200)
 assert.equal(b.status,200)
 assert.match(a.body,/Family HomeLab/)
 assert.match(b.body,/TechTactics/)
 assert.equal(a.body.includes('TechTactics'),false)
 assert.equal(b.body.includes('Family HomeLab'),false)
 assert.equal(a.headers['content-security-policy'].includes("script-src 'none'"),true)
 assert.equal(b.headers['x-frame-options'],'DENY')
 assert.equal(a.headers['referrer-policy'],'no-referrer')
 assert.equal(a.headers['cache-control'],'no-store')
 const css=await call(familyPort,{path:'/auth/portal.css'})
 assert.equal(css.status,200)
 assert.equal(css.headers['content-type'],'text/css; charset=utf-8')
 const landing=await call(businessPort,{host:'portal.example.test',path:'/'})
 assert.equal(landing.status,303)
 assert.equal(landing.headers.location,'/login')
})

test('separate exact HTTP Host binding denies cross-site and spoofed forwarded values',async t=>{
 const f=fixture()
 const port=await serve(t,make(f,'family'))
 for(const host of ['portal.example.test','evil.example.test','family.example.test:443',
  'family.example.test.evil.test','family.example.test@evil.test','family.example.test:3000']){
  assert.equal((await call(port,{host})).status,421)
 }
 assert.equal((await call(port,{headers:{'x-forwarded-host':'portal.example.test'}})).status,421)
 assert.equal((await call(port,{headers:{'forwarded':'host=portal.example.test;proto=https'}})).status,421)
 assert.equal((await call(port,{headers:{'x-forwarded-proto':'http'}})).status,421)
 assert.equal((await call(port,{headers:{'x-friday-role':'Administrator'}})).status,421)
 assert.deepEqual(f.calls.family,[])
})

test('per-site HTTP begin generates browser state cookie and redirects only to configured IdP',async t=>{
 const f=fixture()
 for(const id of ['family','techtactics']){
  const port=await serve(t,make(f,id))
  const res=await call(port,{host:new URL(appOrigins[id]).host,path:'/auth/start'})
  assert.equal(res.status,302)
  assert.equal(new URL(res.headers.location).origin,identity[id])
  assert.match(res.headers['set-cookie'][0],new RegExp('^__Host-friday-oidc-'+id+'='))
  assert.equal(res.headers['location'].includes('portal.example.test'),false)
  assert.equal(f.calls[id].length,1)
 }
})

test('HTTP OIDC callback accepts exactly one state and one code, returns two secure cookies',async t=>{
 const f=fixture()
 const port=await serve(t,make(f,'family'))
 const good=await call(port,{path:'/auth/oidc/callback?state=sample-state&code=sample-code',
  headers:{cookie:'__Host-friday-oidc-family=fixture'}})
 assert.equal(good.status,303)
 assert.equal(good.headers.location,'/account')
 assert.equal(good.headers['set-cookie'].length,2)
 assert.equal(good.body.includes('private-session'),false)
 for(const path of [
  '/auth/oidc/callback?state=sample-state&state=evil&code=sample-code',
  '/auth/oidc/callback?state=sample-state&code=sample-code&redirect=https://evil.test',
  '/auth/oidc/callback?state=sample-state',
  '/auth/oidc/callback?error=access_denied',
  '/auth/oidc/callback?state=%0d%0a&code=sample-code',
 ]){
  const bad=await call(port,{path,headers:{cookie:'__Host-friday-oidc-family=fixture'}})
  assert.equal([400,403].includes(bad.status),true)
 }
 assert.equal(f.calls.family.filter(c=>c[0]==='complete').length,1)
})

test('HTTP account requires matching family/business session cookie and never emits identities in logs',async t=>{
 const f=fixture()
 const fp=await serve(t,make(f,'family'))
 const bp=await serve(t,make(f,'techtactics'))
 const familyAccount=await call(fp,{path:'/account',headers:{cookie:'__Host-friday-session-family=private-session'}})
 const businessAccount=await call(bp,{host:'portal.example.test',path:'/account',headers:{cookie:'__Host-friday-session-techtactics=private-session'}})
 assert.equal(familyAccount.status,200)
 assert.equal(businessAccount.status,200)
 assert.match(familyAccount.body,/csrfToken/)
 assert.match(businessAccount.body,/TechTactics/)
 assert.equal((await call(fp,{path:'/account',
  headers:{cookie:'__Host-friday-session-techtactics=private-session'}})).status,403)
 assert.equal((await call(bp,{host:'portal.example.test',path:'/account',
  headers:{cookie:'__Host-friday-session-family=private-session'}})).status,403)
})

test('HTTP logout requires exact same-site origin, form type, single token and POST method',async t=>{
 const f=fixture()
 const port=await serve(t,make(f,'family'))
 const body='csrfToken='+('x'.repeat(43))
 const basic={path:'/auth/logout',method:'POST',body,headers:{
  cookie:'__Host-friday-session-family=private-session',
  origin:family,
  'content-type':'application/x-www-form-urlencoded',
 }}
 const ok=await call(port,basic)
 assert.equal(ok.status,303)
 assert.equal(ok.headers['set-cookie'].length,2)
 assert.equal(ok.headers.location,'/login')
 for(const v of [
  {...basic,method:'GET',body:undefined},
  {...basic,headers:{...basic.headers,origin:business}},
  {...basic,headers:{...basic.headers,'content-type':'application/json'}},
  {...basic,body:'csrfToken=x&csrfToken='+('x'.repeat(43))},
  {...basic,body:'csrfToken='+('x'.repeat(43))+'&role=Administrator'},
  {...basic,body:'csrfToken=wrong'},
 ]){
  const fail=await call(port,v)
  assert.equal([400,403,405,415].includes(fail.status),true)
 }
 assert.equal(f.calls.family.filter(c=>c[0]==='logout').length,1)
})

test('HTTP adapter denies oversized logout body and unexpected methods before session access',async t=>{
 const f=fixture()
 const port=await serve(t,make(f,'family'))
 const tooLong=await call(port,{method:'POST',path:'/auth/logout',body:'csrfToken='+('x'.repeat(2000)),
  headers:{origin:family,'content-type':'application/x-www-form-urlencoded'}})
 assert.equal(tooLong.status,413)
 assert.equal((await call(port,{method:'PUT',path:'/auth/logout'})).status,405)
 assert.equal((await call(port,{method:'GET',path:'/../auth/start'})).status,404)
 assert.equal((await call(port,{method:'GET',path:'/auth/start?redirect=https://evil.test'})).status,400)
 assert.deepEqual(f.calls.family,[])
})

test('misconfigured handler never enables another realm or leaks a failed callback exception',async t=>{
 const f=fixture()
 for(const config of [
  {applicationId:'family',publicOrigin:business},
  {applicationId:'unknown',publicOrigin:family},
  {applicationId:'family',publicOrigin:'http://family.example.test'},
  {applicationId:'family',publicOrigin:family,sites:{}},
 ]){
  const port=await serve(t,createLoginSiteHttpHandler({enabled:true,sites:f.sites,...config}))
  assert.equal((await call(port)).status,503)
 }
 const live=await serve(t,make(f,'family'))
 const error=await call(live,{path:'/auth/oidc/callback?state=sample-state&code=sample-code',
  headers:{cookie:'__Host-friday-oidc-family=invalid'}})
 assert.equal(error.status,403)
 assert.equal(error.body.includes('PRIVATE_CALLBACK_ERROR'),false)
})
