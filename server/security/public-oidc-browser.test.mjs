import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createPublicOidcBrowser} from './public-oidc-browser.mjs'

const NOW=1793034000000
const apps=[{id:'friday',origin:'https://friday.example.test'},
 {id:'site',origin:'https://site.example.test'}]
const CONTROL=()=>randomBytes(32).toString('base64url')
async function fixture(t,overrides={}){
 let clock=NOW,beginCalls=0,completeCalls=0
 const pending=new Map(),sessions=new Map()
 const flow={
  async begin({applicationId}){
   beginCalls++
   const state=CONTROL()
   pending.set(state,applicationId)
   return {applicationId,authorizationUrl:'https://login.example.test/application/o/authorize/?state='+state}
  },
  async complete({applicationId,state,code}){
   completeCalls++
   assert.equal(code,'synthetic-code')
   if(pending.get(state)!==applicationId)throw Error('sso-denied')
   pending.delete(state)
   return {applicationId,identity:{
    kind:'human',subject:'authentik:issuer:user-123',expiresAtMs:clock+600000,
   }}
  },
 }
 const store={
  async create(row){
   assert.equal(sessions.has(row.tokenHash),false)
   sessions.set(row.tokenHash,row)
  },
  async read({applicationId,tokenHash}){
   const record=sessions.get(tokenHash)
   return record?.applicationId===applicationId?record:null
  },
  async revoke({applicationId,tokenHash}){
   const record=sessions.get(tokenHash)
   if(!record||record.applicationId!==applicationId)return false
   sessions.delete(tokenHash)
   return true
  },
 }
 const browser=createPublicOidcBrowser({
  enabled:true,applications:apps,flow,sessionStore:store,
  signingKey:randomBytes(32),now:()=>clock,...overrides,
 })
 return {browser,pending,sessions,store,flow,apps,setTime:x=>{clock=x},
  begins:()=>beginCalls,completes:()=>completeCalls}
}
const start=async(f,id='friday')=>{
 const origin=id==='friday'?apps[0].origin:apps[1].origin
 const result=await f.browser.begin({applicationId:id,origin})
 const state=new URL(result.authorizationUrl).searchParams.get('state')
 const cookie=result.setCookie.split(';')[0]
 return {origin,state,cookie,...result}
}
const callback=(s,id='friday',changes={})=>({
 applicationId:id,origin:id==='friday'?apps[0].origin:apps[1].origin,
 state:s.state,code:'synthetic-code',cookieHeader:s.cookie,...changes,
})
const sessionCookie=login=>login.setCookies[1].split(';')[0]

test('disabled by default never calls OIDC flow or session storage',async t=>{
 const f=await fixture(t,{enabled:false})
 assert.equal(f.browser.enabled,false)
 await assert.rejects(f.browser.begin({applicationId:'friday',origin:apps[0].origin}),/sso-denied/)
 await assert.rejects(f.browser.complete({}),/sso-denied/)
 await assert.rejects(f.browser.current({}),/sso-denied/)
 await assert.rejects(f.browser.logout({}),/sso-denied/)
 assert.equal(f.begins(),0)
})

test('begin sets only origin-bound, host-only HttpOnly Secure SameSite=Lax transient cookie',async t=>{
 const f=await fixture(t)
 const a=await start(f),b=await start(f,'site')
 assert.equal(a.authorizationUrl.startsWith('https://login.example.test/'),true)
 assert.match(a.setCookie,/^__Host-friday-oidc-friday=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=300; Secure; HttpOnly; SameSite=Lax$/)
 assert.match(b.setCookie,/^__Host-friday-oidc-site=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=300; Secure; HttpOnly; SameSite=Lax$/)
 assert.equal(a.setCookie.includes(a.state),false)
 assert.equal(a.setCookie.includes('Domain='),false)
 assert.equal(b.setCookie.includes('Domain='),false)
 assert.notEqual(a.cookie,b.cookie)
 assert.equal(f.begins(),2)
})

test('untrusted app, host and malformed request are denied before authorization redirect',async t=>{
 const f=await fixture(t)
 for(const input of [
  {applicationId:'friday',origin:'http://friday.example.test'},
  {applicationId:'friday',origin:'https://site.example.test'},
  {applicationId:'site',origin:'https://friday.example.test'},
  {applicationId:'unknown',origin:apps[0].origin},
  {applicationId:'friday',origin:apps[0].origin,redirect:'https://evil.test'},
  {applicationId:'friday',origin:apps[0].origin,clientId:'admin'},
  {},
 ]){
  await assert.rejects(f.browser.begin(input),/sso-denied/)
 }
 assert.equal(f.begins(),0)
})

test('callback must present correct original browser cookie before consuming OAuth code',async t=>{
 const f=await fixture(t)
 const s=await start(f)
 const alternate=await start(f)
 for(const changes of [
  {cookieHeader:''},{cookieHeader:'another=thing'},
  {cookieHeader:alternate.cookie},
  {cookieHeader:s.cookie+'; '+s.cookie},
  {cookieHeader:'__Host-friday-oidc-friday=bad'},
  {origin:'https://site.example.test'},
  {state:CONTROL()},
  {code:'synthetic-code',redirect:'https://evil.test'},
 ]){
  await assert.rejects(f.browser.complete(callback(s,'friday',changes)),/sso-denied/)
 }
 await assert.rejects(f.browser.complete(callback(s,'site')),/sso-denied/)
 assert.equal(f.completes(),0)
 const accepted=await f.browser.complete(callback(s))
 assert.equal(accepted.state,'authenticated')
 assert.equal(f.completes(),1)
 await assert.rejects(f.browser.complete(callback(s)),/sso-denied/)
})

test('successful callback provisions opaque host-only session; no raw token in JSON body',async t=>{
 const f=await fixture(t),s=await start(f)
 const login=await f.browser.complete(callback(s))
 assert.equal(login.applicationId,'friday')
 assert.equal(login.state,'authenticated')
 assert.equal(login.identity.kind,'human')
 assert.equal(login.identity.subject,'authentik:issuer:user-123')
 assert.equal(login.setCookies.length,2)
 assert.match(login.setCookies[0],/^__Host-friday-oidc-friday=; Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=Lax$/)
 assert.match(login.setCookies[1],/^__Host-friday-session-friday=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/)
 assert.equal(login.setCookies[1].includes('Domain='),false)
 const bearer=sessionCookie(login).split('=')[1]
 assert.equal(JSON.stringify(login).includes(bearer),true) // only in Set-Cookie, never in structured body
 assert.equal(JSON.stringify({...login,setCookies:undefined}).includes(bearer),false)
 const row=[...f.sessions.values()][0]
 assert.equal(row.applicationId,'friday')
 assert.equal(row.subject,'authentik:issuer:user-123')
 assert.equal(row.tokenHash.includes(bearer),false)
 assert.equal(JSON.stringify(row).includes(bearer),false)
 assert.equal(f.sessions.size,1)
})

test('current session is bound to exact application and rejects duplicate or forged cookies',async t=>{
 const f=await fixture(t),s=await start(f)
 const login=await f.browser.complete(callback(s))
 const cookie=sessionCookie(login)
 const current=await f.browser.current({applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie})
 assert.equal(current.identity.kind,'human')
 assert.equal(current.identity.subject,'authentik:issuer:user-123')
 assert.match(current.csrfToken,/^[A-Za-z0-9_-]{43}$/)
 assert.equal(current.applicationId,'friday')
 for(const input of [
  {applicationId:'site',origin:apps[1].origin,cookieHeader:cookie},
  {applicationId:'friday',origin:apps[1].origin,cookieHeader:cookie},
  {applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie+'; '+cookie},
  {applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie+'tampered'},
  {applicationId:'friday',origin:apps[0].origin,cookieHeader:'session=spoof'},
  {applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie,role:'Administrator'},
 ]){
  await assert.rejects(f.browser.current(input),/sso-denied/)
 }
})

test('CSRF-validated exact-origin logout revokes opaque server session and clears cookies',async t=>{
 const f=await fixture(t),s=await start(f)
 const login=await f.browser.complete(callback(s)),cookie=sessionCookie(login)
 const active=await f.browser.current({applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie})
 const input={applicationId:'friday',origin:apps[0].origin,
  originHeader:apps[0].origin,cookieHeader:cookie,csrfToken:active.csrfToken}
 for(const override of [
  {csrfToken:'bad'},{originHeader:'https://evil.test'},
  {originHeader:''},{cookieHeader:'bad'},
  {applicationId:'site',origin:apps[1].origin},
  {redirect:'https://evil.test'},
 ]){
  await assert.rejects(f.browser.logout({...input,...override}),/sso-denied/)
 }
 const result=await f.browser.logout(input)
 assert.equal(result.state,'signed-out')
 assert.equal(result.setCookies.length,2)
 assert.equal(result.setCookies.every(cookie=>cookie.includes('Max-Age=0')),true)
 assert.equal(f.sessions.size,0)
 await assert.rejects(f.browser.current({applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie}),/sso-denied/)
 await assert.rejects(f.browser.logout(input),/sso-denied/)
})

test('session expiry and stale or inconsistent storage deny on every read',async t=>{
 const f=await fixture(t),s=await start(f)
 const login=await f.browser.complete(callback(s)),cookie=sessionCookie(login)
 const base={applicationId:'friday',origin:apps[0].origin,cookieHeader:cookie}
 f.setTime(NOW+600001)
 await assert.rejects(f.browser.current(base),/sso-denied/)
 const other=await fixture(t,{sessionStore:{
  create:async()=>{},read:async()=>({applicationId:'site',tokenHash:'fake',subject:'guest',createdAt:NOW,expiresAt:NOW+600000}),revoke:async()=>true,
 }})
 const x=await start(other)
 const done=await other.browser.complete(callback(x))
 await assert.rejects(other.browser.current({applicationId:'friday',origin:apps[0].origin,cookieHeader:sessionCookie(done)}),/sso-denied/)
})

test('configuration denies insecure origins, missing store/flow, repeated application IDs and weak keys',async t=>{
 for(const overrides of [
  {applications:[{id:'friday',origin:'http://friday.example.test'}]},
  {applications:[{id:'friday',origin:'https://*.example.test'}]},
  {applications:[apps[0],apps[0]]},
  {applications:[{id:'friday',origin:'https://friday.example.test/path'}]},
  {signingKey:Buffer.alloc(8)},
  {sessionStore:{}},{flow:{}},
 ]){
  const f=await fixture(t,overrides)
  assert.equal(f.browser.enabled,false)
  await assert.rejects(f.browser.begin({applicationId:'friday',origin:apps[0].origin}),/sso-denied/)
 }
})
