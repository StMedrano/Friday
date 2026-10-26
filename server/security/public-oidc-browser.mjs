import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto'

const ID=/^[a-z][a-z0-9-]{1,62}$/
const TOKEN=/^[A-Za-z0-9_-]{43}$/
const SUBJECT=/^authentik:[a-f0-9]{16}:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/
const TTL=3600000
const STATE_TTL=300000
const denied=()=>{throw Error('sso-denied')}
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const isSubject=value=>typeof value==='string'&&SUBJECT.test(value)
const timeValid=value=>Number.isSafeInteger(value)&&value>=0

function validOrigin(value) {
 if(typeof value!=='string'||value.length>512)return false
 try {
  const url=new URL(value)
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
   url.pathname==='/'&&!url.search&&!url.hash&&url.origin===value&&
   url.hostname.includes('.')&&!url.hostname.includes('*')&&
   !['localhost','local'].includes(url.hostname.split('.').at(-1))
 }catch{return false}
}
function cookieValue(header,name) {
 if(typeof header!=='string'||header.length>4096)denied()
 let result=null
 for(const fragment of header.split(';')){
  const item=fragment.trim()
  const eq=item.indexOf('=')
  if(eq<1)continue
  const key=item.slice(0,eq),value=item.slice(eq+1)
  if(key!==name)continue
  if(result!==null||!TOKEN.test(value))denied()
  result=value
 }
 if(result===null)denied()
 return result
}
const secret=()=>randomBytes(32).toString('base64url')
const constantTime=(left,right)=>{
 if(typeof left!=='string'||typeof right!=='string')return false
 const a=Buffer.from(left),b=Buffer.from(right)
 return a.length===b.length&&timingSafeEqual(a,b)
}
const cookie=(name,value,ttl)=>
 `${name}=${value}; Path=/; Max-Age=${ttl}; Secure; HttpOnly; SameSite=Lax`

/**
 * Source-only, NOT connected to Friday's HTTP router or production auth.
 * App-specific HttpOnly cookies keep the OAuth callback bound to the browser
 * that began it. Separate per-site, server-backed opaque session handles
 * remain lower-privilege than P8 HomeLab tool authorization.
 *
 * The caller MUST provide a durable transactional sessionStore with
 * create(record), read({applicationId,tokenHash}) and revoke(...).
 * It MUST enforce atomic uniqueness, TTL, cleanup and account revocation.
 * This module alone does not establish a complete web SSO deployment.
 */
export function createPublicOidcBrowser({
 enabled=false,applications,flow,sessionStore,signingKey,now=Date.now,
}={}) {
 let configured=enabled===true&&Buffer.isBuffer(signingKey)&&
  signingKey.length===32&&typeof now==='function'&&
  typeof flow?.begin==='function'&&typeof flow?.complete==='function'&&
  typeof sessionStore?.create==='function'&&typeof sessionStore?.read==='function'&&
  typeof sessionStore?.revoke==='function'&&Array.isArray(applications)&&
  applications.length>=1&&applications.length<=25
 const apps=new Map()
 if(configured) {
  for(const app of applications){
   if(!exact(app,['id','origin'])||typeof app.id!=='string'||
      !ID.test(app.id)||!validOrigin(app.origin)||apps.has(app.id)){
    configured=false
    break
   }
   apps.set(app.id,app.origin)
  }
 }
 const currentTime=()=>{
  const at=now()
  if(!timeValid(at))denied()
  return at
 }
 const appFor=(input,fields)=>{
  if(!configured||!exact(input,fields))denied()
  const origin=apps.get(input.applicationId)
  if(!origin||origin!==input.origin)denied()
  return {id:input.applicationId,origin,
   pendingName:`__Host-friday-oidc-${input.applicationId}`,
   sessionName:`__Host-friday-session-${input.applicationId}`}
 }
 const hmac=(context,bytes)=>createHmac('sha256',signingKey)
  .update(context).update(':').update(bytes).digest('base64url')
 const bind=(app,state)=>hmac('login:'+app.id+':'+app.origin,state)
 const digest=(app,value)=>hmac('session:'+app.id+':'+app.origin,value)
 const csrf=(app,value)=>hmac('csrf:'+app.id+':'+app.origin,value)
 const sessionFrom=async(app,header)=>{
  const opaque=cookieValue(header,app.sessionName)
  const tokenHash=digest(app,opaque)
  let row
  try{row=await sessionStore.read({applicationId:app.id,tokenHash})}
  catch{denied()}
  const at=currentTime()
  if(!exact(row,['applicationId','tokenHash','subject','createdAt','expiresAt'])||
     row.applicationId!==app.id||row.tokenHash!==tokenHash||
     !isSubject(row.subject)||!timeValid(row.createdAt)||
     !timeValid(row.expiresAt)||row.createdAt>at||row.expiresAt<=at||
     row.expiresAt<=row.createdAt||row.expiresAt-row.createdAt>TTL)denied()
  return {opaque,tokenHash,row}
 }
 return Object.freeze({
  enabled:configured,
  async begin(input){
   const app=appFor(input,['applicationId','origin'])
   let started
   try{started=await flow.begin({applicationId:app.id})}catch{denied()}
   if(started?.applicationId!==app.id||typeof started.authorizationUrl!=='string')denied()
   let state
   try{state=new URL(started.authorizationUrl).searchParams.get('state')}catch{denied()}
   if(!TOKEN.test(state))denied()
   // The signed transient cookie does not contain or expose raw OAuth state
   // but binds the callback state to its initiating browser and application.
   return {applicationId:app.id,authorizationUrl:started.authorizationUrl,
    setCookie:cookie(app.pendingName,bind(app,state),300)}
  },
  async complete(input){
   const app=appFor(input,['applicationId','origin','state','code','cookieHeader'])
   if(typeof input.state!=='string'||!TOKEN.test(input.state)||
      typeof input.code!=='string'||input.code.length<1||input.code.length>2048)denied()
   // Authenticate browser binding BEFORE consuming the single-use OAuth
   // transaction or exchanging any authorization code.
   const submitted=cookieValue(input.cookieHeader,app.pendingName)
   if(!constantTime(submitted,bind(app,input.state)))denied()
   let completed
   try{completed=await flow.complete({
    applicationId:app.id,state:input.state,code:input.code,
   })}catch{denied()}
   const at=currentTime(),identity=completed?.identity
   if(completed?.applicationId!==app.id||identity?.kind!=='human'||
      !isSubject(identity.subject)||!timeValid(identity.expiresAtMs)||
      identity.expiresAtMs<=at)denied()
   const expiresAt=Math.min(identity.expiresAtMs,at+TTL)
   const lifespan=Math.floor((expiresAt-at)/1000)
   if(lifespan<1)denied()
   const opaque=secret(),tokenHash=digest(app,opaque)
   const row={applicationId:app.id,tokenHash,
    subject:identity.subject,createdAt:at,expiresAt}
   try{await sessionStore.create(row)}catch{denied()}
   // Return normalized identity only. The session bearer is restricted to
   // the Set-Cookie field and is not stored in sessionStore or JSON data.
   return {applicationId:app.id,state:'authenticated',
    identity:{kind:'human',subject:identity.subject},
    setCookies:[cookie(app.pendingName,'',0),cookie(app.sessionName,opaque,lifespan)]}
  },
  async current(input){
   const app=appFor(input,['applicationId','origin','cookieHeader'])
   const {opaque,row}=await sessionFrom(app,input.cookieHeader)
   return {applicationId:app.id,identity:{kind:'human',subject:row.subject},
    csrfToken:csrf(app,opaque),expiresAt:row.expiresAt}
  },
  async logout(input){
   const app=appFor(input,['applicationId','origin','originHeader','cookieHeader','csrfToken'])
   if(input.originHeader!==app.origin||typeof input.csrfToken!=='string'||
      !TOKEN.test(input.csrfToken))denied()
   const {opaque,tokenHash}=await sessionFrom(app,input.cookieHeader)
   if(!constantTime(input.csrfToken,csrf(app,opaque)))denied()
   let revoked
   try{revoked=await sessionStore.revoke({applicationId:app.id,tokenHash})}
   catch{denied()}
   if(revoked!==true)denied()
   return {applicationId:app.id,state:'signed-out',
    setCookies:[cookie(app.pendingName,'',0),cookie(app.sessionName,'',0)]}
  },
 })
}
