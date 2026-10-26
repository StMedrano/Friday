import test from 'node:test'
import assert from 'node:assert/strict'
import {createLoginSites} from './login-sites.mjs'

const origins={
 family:'https://family.example.test',
 techtactics:'https://business.example.test',
}
const identityOrigins={
 family:'https://family-id.example.test',
 techtactics:'https://business-id.example.test',
}
function fixture(overrides={}){
 const calls=[]
 const sessionTokens={family:'family-token',techtactics:'business-token'}
 const mockBrowser=(id)=>({
  async begin(data){
   calls.push([id,'begin',data])
   return {applicationId:id,authorizationUrl:identityOrigins[id]+'/application/o/authorize/?state=test',
    setCookie:'__Host-friday-oidc-'+id+'=some-digest; Path=/; Secure; HttpOnly; SameSite=Lax',
   }
  },
  async complete(data){
   calls.push([id,'complete',data])
   if(!data.cookieHeader?.includes('__Host-friday-oidc-'+id+'=some-digest'))throw Error('private-stack-trace')
   return {applicationId:id,state:'authenticated',
    setCookies:['__Host-friday-oidc-'+id+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
      '__Host-friday-session-'+id+'='+sessionTokens[id]+'; Path=/; Secure; HttpOnly; SameSite=Lax'],
   }
  },
  async current(data){
   calls.push([id,'current',data])
   if(!data.cookieHeader?.includes('__Host-friday-session-'+id+'='+sessionTokens[id]))
    throw Error('internal-secret')
   return {applicationId:id,csrfToken:'x'.repeat(43),identity:{kind:'human',subject:'private-user'}}
  },
  async logout(data){
   calls.push([id,'logout',data])
   if(data.csrfToken!=='x'.repeat(43)||data.originHeader!==origins[id])throw Error('internal-secret')
   return {applicationId:id,state:'signed-out',
    setCookies:['__Host-friday-oidc-'+id+'=; Max-Age=0; Secure; HttpOnly; SameSite=Lax',
     '__Host-friday-session-'+id+'=; Max-Age=0; Secure; HttpOnly; SameSite=Lax'],
   }
  },
 })
 const sites=[{id:'family',origin:origins.family,identityOrigin:identityOrigins.family,browser:mockBrowser('family')},
  {id:'techtactics',origin:origins.techtactics,identityOrigin:identityOrigins.techtactics,browser:mockBrowser('techtactics')}]
 const login=createLoginSites({enabled:true,sites,...overrides})
 return {login,calls,sessionTokens}
}
const route=(id,path,extras={})=>({method:'GET',origin:origins[id],path,...extras})

test('disabled by default: no site, login, session or IdP redirect becomes reachable',async()=>{
 const f=fixture({enabled:false})
 for(const id of ['family','techtactics']){
  for(const path of ['/login','/auth/start','/auth/oidc/callback','/account','/auth/portal.css']){
   const reply=await f.login.handle(route(id,path))
   assert.equal(reply.status,503)
  }
 }
 assert.deepEqual(f.calls,[])
})

test('two separately branded family and TechTactics responsive login pages, never mixed',async()=>{
 const f=fixture()
 for(const [id,expected,forbidden] of [
  ['family','Family HomeLab','TechTactics'],
  ['techtactics','TechTactics','Family HomeLab'],
 ]){
  const reply=await f.login.handle(route(id,'/login'))
  assert.equal(reply.status,200)
  assert.equal(reply.headers['content-type'],'text/html; charset=utf-8')
  assert.equal(reply.headers['cache-control'],'no-store')
  assert.equal(reply.headers['x-frame-options'],'DENY')
  assert.equal(reply.headers['content-security-policy'].includes("script-src"),true)
  assert.match(reply.body,/name="viewport"/)
  assert.match(reply.body,/href="\/auth\/start"/)
  assert.match(reply.body,/<main/)
  assert.match(reply.body,new RegExp(expected))
  assert.equal(reply.body.includes(forbidden),false)
  assert.equal(reply.body.includes('private-user'),false)
  assert.equal(reply.body.includes('clientSecret'),false)
  assert.equal(reply.body.includes('http://'),false)
 }
 const styles=await f.login.handle(route('family','/auth/portal.css'))
 assert.equal(styles.status,200)
 assert.equal(styles.headers['content-type'],'text/css; charset=utf-8')
 assert.match(styles.body,/\.family/)
 assert.match(styles.body,/\.techtactics/)
 assert.match(styles.body,/@media/)
 assert.deepEqual(f.calls,[])
})

test('two login buttons reach only their separately registered branded Authentik domains',async()=>{
 const f=fixture()
 for(const id of ['family','techtactics']){
  const result=await f.login.handle(route(id,'/auth/start'))
  assert.equal(result.status,302)
  assert.equal(new URL(result.headers.location).origin,identityOrigins[id])
  assert.equal(result.headers.location.includes('state=test'),true)
  assert.equal(result.headers['set-cookie'].startsWith('__Host-friday-oidc-'+id+'='),true)
  assert.equal(result.headers['cache-control'],'no-store')
 }
 assert.deepEqual(f.calls.map(x=>[x[0],x[1]]),[['family','begin'],['techtactics','begin']])
})

test('callback returns per-site session cookies and never exposes them in response body',async()=>{
 const f=fixture()
 const login=await f.login.handle(route('family','/auth/oidc/callback',{
  query:{state:'test-state',code:'test-code'},cookieHeader:'__Host-friday-oidc-family=some-digest',
 }))
 assert.equal(login.status,303)
 assert.equal(login.headers.location,'/account')
 assert.equal(login.headers['set-cookie'].length,2)
 assert.equal(login.headers['set-cookie'][1].includes('__Host-friday-session-family'),true)
 assert.equal(login.body.includes('family-token'),false)
 const business=await f.login.handle(route('techtactics','/auth/oidc/callback',{
  query:{state:'test-state',code:'test-code'},cookieHeader:'__Host-friday-oidc-techtactics=some-digest',
 }))
 assert.equal(business.status,303)
 assert.equal(business.headers['set-cookie'][1].includes('__Host-friday-session-techtactics'),true)
 assert.equal(business.body.includes('business-token'),false)
})

test('family cookie cannot access business portal, and business cookie cannot access family portal',async()=>{
 const f=fixture()
 const family=await f.login.handle(route('family','/account',{
  cookieHeader:'__Host-friday-session-family=family-token'}))
 assert.equal(family.status,200)
 assert.match(family.body,/Family HomeLab/)
 assert.equal(family.body.includes('TechTactics'),false)
 assert.match(family.body,/name="csrfToken"/)
 const business=await f.login.handle(route('techtactics','/account',{
  cookieHeader:'__Host-friday-session-techtactics=business-token'}))
 assert.equal(business.status,200)
 assert.match(business.body,/TechTactics/)
 assert.equal(business.body.includes('Family HomeLab'),false)
 for(const [id,cookie] of [
  ['family','__Host-friday-session-techtactics=business-token'],
  ['techtactics','__Host-friday-session-family=family-token'],
 ]){
  const r=await f.login.handle(route(id,'/account',{cookieHeader:cookie}))
  assert.equal(r.status,403)
  assert.equal(r.body.includes('private'),false)
 }
})

test('logout is POST-only with exact origin and CSRF token, clears only that site cookies',async()=>{
 const f=fixture()
 const url=route('techtactics','/auth/logout',{
  method:'POST',cookieHeader:'__Host-friday-session-techtactics=business-token',
  originHeader:origins.techtactics,csrfToken:'x'.repeat(43),
 })
 assert.equal((await f.login.handle({...url,method:'GET'})).status,405)
 assert.equal((await f.login.handle({...url,originHeader:origins.family})).status,403)
 assert.equal((await f.login.handle({...url,csrfToken:'bad'})).status,403)
 const result=await f.login.handle(url)
 assert.equal(result.status,303)
 assert.equal(result.headers.location,'/login')
 assert.equal(result.headers['set-cookie'].length,2)
 assert.equal(result.headers['set-cookie'].every(x=>x.includes('Max-Age=0')),true)
 assert.equal(result.headers['set-cookie'].some(x=>x.includes('family')),false)
})

test('denies unexpected origins, paths, methods, callback query fields, and identity spoofing',async()=>{
 const f=fixture()
 for(const input of [
  {method:'GET',origin:'https://attacker.example.test',path:'/login'},
  {method:'GET',origin:'http://family.example.test',path:'/login'},
  {method:'GET',origin:origins.family,path:'//evil.test/login'},
  {method:'GET',origin:origins.family,path:'/../auth/start'},
  {method:'POST',origin:origins.family,path:'/auth/start'},
  {method:'GET',origin:origins.family,path:'/auth/oidc/callback',query:{state:'abc',code:'def',role:'Administrator'}},
  {method:'GET',origin:origins.family,path:'/auth/oidc/callback',query:{state:'abc',code:'def',redirect:'https://evil.test'}},
  {method:'GET',origin:origins.family,path:'/auth/oidc/callback',query:{error:'access_denied'}},
  {method:'GET',origin:origins.family,path:'/admin'},
  {method:'POST',origin:origins.family,path:'/auth/oidc/callback'},
 ]){
  const result=await f.login.handle(input)
  assert.equal([400,403,404,405].includes(result.status),true)
  assert.equal(JSON.stringify(result).includes('private'),false)
 }
 assert.deepEqual(f.calls,[])
})

test('invalid duplicate login domains, shared IdP realm, missing browser or insecure host refuse both sites',async()=>{
 for(const override of [
  {sites:[{id:'family',origin:origins.family,identityOrigin:identityOrigins.family,browser:{}},
   {id:'techtactics',origin:origins.techtactics,identityOrigin:identityOrigins.techtactics,browser:{}}]},
  {sites:[{id:'family',origin:origins.family,identityOrigin:identityOrigins.family,browser:fixture().login},
   {id:'techtactics',origin:origins.family,identityOrigin:identityOrigins.techtactics,browser:fixture().login}]},
  {sites:[]},
 ]){
  const f=fixture(override)
  assert.equal(f.login.enabled,false)
  assert.equal((await f.login.handle(route('family','/login'))).status,503)
 }
})

test('AuthentiK outage is generic fail-closed, never leaks exception or redirects to another realm',async()=>{
 const f=fixture()
 const broken={async begin(){throw Error('secret-credentials-in-stacktrace')},
  async complete(){throw Error('secret-credentials-in-stacktrace')},
  async current(){throw Error('secret-credentials-in-stacktrace')},
  async logout(){throw Error('secret-credentials-in-stacktrace')}}
 const bad=createLoginSites({enabled:true,sites:[
  {id:'family',origin:origins.family,identityOrigin:identityOrigins.family,browser:broken},
  {id:'techtactics',origin:origins.techtactics,identityOrigin:identityOrigins.techtactics,browser:broken},
 ]})
 for(const path of ['/auth/start','/auth/oidc/callback','/account']){
  const out=await bad.handle(route('family',path))
  assert.equal(out.status>=400,true)
  assert.equal(JSON.stringify(out).includes('secret-credentials'),false)
 }
})
