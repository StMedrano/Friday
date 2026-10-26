import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto'
import {authentikRoleSubject} from './authentik.mjs'

const ID=/^[a-z][a-z0-9-]{1,62}$/
const CLIENT=/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/
const JWT=/^[A-Za-z0-9_-]+$/
const CONTROL=/^[A-Za-z0-9_-]{43}$/
const CODE=/^[\x21-\x7e]{1,2048}$/
const DENIED=()=>{throw Error('sso-denied')}
const exact=(row,keys)=>row&&typeof row==='object'&&!Array.isArray(row)&&
 Object.keys(row).length===keys.length&&keys.every(k=>Object.hasOwn(row,k))
const nowOk=n=>Number.isSafeInteger(n)&&n>=0
const expiryMs=300000

function validateConfig(config,transactions,fetchImpl,clock){
 if(config?.enabled!==true||typeof fetchImpl!=='function'||typeof clock!=='function'||
    typeof transactions?.reserve!=='function'||typeof transactions?.consume!=='function')return null
 let origin
 try {
  const parsed=new URL(config.identityOrigin)
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||
     parsed.pathname!=='/'||parsed.search||parsed.hash||
     parsed.origin!==config.identityOrigin||!parsed.hostname.includes('.')||
     parsed.hostname==='localhost'||parsed.hostname.includes('*'))return null
  origin=parsed.origin
 }catch{return null}
 if(!Array.isArray(config.applications)||!config.applications.length||
    config.applications.length>25)return null
 const map=new Map(),slugs=new Set(),clients=new Set(),redirects=new Set()
 for(const app of config.applications){
  if(!exact(app,['id','slug','clientId','clientSecret','redirectUri'])||
     typeof app.id!=='string'||!ID.test(app.id)||
     typeof app.slug!=='string'||!ID.test(app.slug)||
     typeof app.clientId!=='string'||!CLIENT.test(app.clientId)||
     typeof app.clientSecret!=='string'||app.clientSecret.length<8||app.clientSecret.length>256||
     /[\r\n\x00-\x1f]/.test(app.clientSecret)||
     map.has(app.id)||slugs.has(app.slug)||clients.has(app.clientId)||
     redirects.has(app.redirectUri))return null
  let redirect
  try {
   redirect=new URL(app.redirectUri)
   if(redirect.protocol!=='https:'||redirect.username||redirect.password||
      redirect.search||redirect.hash||redirect.port||
      redirect.origin===origin||redirect.origin+redirect.pathname!==app.redirectUri||
      redirect.pathname==='/'
      ||redirect.hostname.includes('*')||!redirect.hostname.includes('.'))return null
  }catch{return null}
  map.set(app.id,Object.freeze({...app,issuer:origin+'/application/o/'+app.slug+'/'}))
  slugs.add(app.slug);clients.add(app.clientId);redirects.add(app.redirectUri)
 }
 return Object.freeze({origin,map})
}

/**
 * Source-only multi-application public Authentik OIDC authorization-code/PKCE
 * foundation. No HTTP route, cookie, browser token storage, login UI, session,
 * privileged HomeLab capability, or production identity override.
 *
 * Each public application has a *different* OIDC issuer/slug/client/redirect.
 * A deployment MUST supply a distributed atomic one-use transaction store
 * (reserve/consume with a 5m TTL), an HttpOnly session implementation, a
 * CSRF-safe callback and redirect policy, and rate limiting before use.
 */
export function createPublicOidcFlow(config={},{
 transactions,fetchImpl=fetch,now=Date.now,
}={}) {
 const validated=validateConfig(config,transactions,fetchImpl,now)
 const apps=validated?.map
 const origin=validated?.origin
 const fetchJSON=async (url,options)=>{
  const response=await fetchImpl(url,{
   redirect:'error',signal:AbortSignal.timeout(5000),...options,
  })
  if(!response?.ok)DENIED()
  const result=await response.json()
  if(!result||typeof result!=='object'||Array.isArray(result)||
     JSON.stringify(result).length>16384)DENIED()
  return result
 }
 async function signedIdentity(app,idToken,nonce) {
  if(typeof idToken!=='string'||idToken.length>8192)DENIED()
  const parts=idToken.split('.')
  if(parts.length!==3||parts.some(p=>!p||!JWT.test(p)))DENIED()
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'))
  const at=now(),sec=Math.floor(at/1000)
  if(!nowOk(at)||header?.alg!=='RS256'||(header.typ!==undefined&&
     !['JWT','id_token'].includes(header.typ))||
     typeof header.kid!=='string'||header.kid.length>128||!JWT.test(header.kid)||
     claims?.iss!==app.issuer||
     !(claims.aud===app.clientId||(Array.isArray(claims.aud)&&claims.aud.includes(app.clientId)))||
     (Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==app.clientId)||
     (claims.azp!==undefined&&claims.azp!==app.clientId)||
     typeof claims.nonce!=='string'||claims.nonce!==nonce||
     !nowOk(claims.exp)||!nowOk(claims.iat)||claims.exp<=sec||
     claims.iat>sec||claims.exp<=claims.iat||claims.exp-claims.iat>900||
     (claims.nbf!==undefined&&(!nowOk(claims.nbf)||claims.nbf>sec)))DENIED()
  const subject=authentikRoleSubject({issuer:app.issuer,sub:claims.sub})
  if(!subject)DENIED()
  const keyset=await fetchJSON(app.issuer+'jwks/')
  if(!Array.isArray(keyset.keys)||keyset.keys.length<1||keyset.keys.length>16)DENIED()
  let key=null,found=false
  for(const item of keyset.keys){
   if(item?.kid!==header.kid)continue
   if(found||item.kty!=='RSA'||item.alg!=='RS256'||item.use!=='sig')DENIED()
   found=true
   key=createPublicKey({key:item,format:'jwk'})
  }
  if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
    key,Buffer.from(parts[2],'base64url')))DENIED()
  return Object.freeze({kind:'human',subject,expiresAtMs:claims.exp*1000})
 }
 return Object.freeze({
  enabled:Boolean(apps),
  async begin(input) {
   if(!apps||!exact(input,['applicationId']))DENIED()
   const app=apps.get(input.applicationId)
   if(!app)DENIED()
   const at=now()
   if(!nowOk(at)||at>Number.MAX_SAFE_INTEGER-expiryMs)DENIED()
   const state=randomBytes(32).toString('base64url')
   const nonce=randomBytes(32).toString('base64url')
   const verifier=randomBytes(32).toString('base64url')
   const challenge=createHash('sha256').update(verifier).digest('base64url')
   await transactions.reserve({state,applicationId:app.id,
    issuer:app.issuer,clientId:app.clientId,nonce,verifier,
    issuedAt:at,expiresAt:at+expiryMs})
   const url=new URL(origin+'/application/o/authorize/')
   url.searchParams.set('response_type','code')
   url.searchParams.set('client_id',app.clientId)
   url.searchParams.set('redirect_uri',app.redirectUri)
   url.searchParams.set('scope','openid profile email')
   url.searchParams.set('state',state)
   url.searchParams.set('nonce',nonce)
   url.searchParams.set('code_challenge_method','S256')
   url.searchParams.set('code_challenge',challenge)
   return {applicationId:app.id,authorizationUrl:url.href}
  },
  async complete(input) {
   if(!apps||!exact(input,['applicationId','state','code'])||
      typeof input.applicationId!=='string'||!apps.has(input.applicationId)||
      typeof input.state!=='string'||!CONTROL.test(input.state)||
      typeof input.code!=='string'||!CODE.test(input.code))DENIED()
   // Atomic consume-before-exchange is mandatory: replay, cross-site state,
   // callback races and server restart must NEVER reuse a login transaction.
   let tx
   try {tx=await transactions.consume(input.state)}catch{DENIED()}
   const app=apps.get(input.applicationId)
   const at=now()
   if(!tx||!nowOk(at)||tx.state!==input.state||
      tx.applicationId!==app.id||tx.issuer!==app.issuer||
      tx.clientId!==app.clientId||!CONTROL.test(tx.nonce)||
      !CONTROL.test(tx.verifier)||!nowOk(tx.issuedAt)||!nowOk(tx.expiresAt)||
      tx.issuedAt>at||tx.expiresAt<=at||
      tx.expiresAt-tx.issuedAt!==expiryMs)DENIED()
   try{
    const metadata=await fetchJSON(app.issuer+'.well-known/openid-configuration')
    if(metadata.issuer!==app.issuer||metadata.jwks_uri!==app.issuer+'jwks/'||
       metadata.authorization_endpoint!==origin+'/application/o/authorize/'||
       metadata.token_endpoint!==origin+'/application/o/token/')DENIED()
    const body=new URLSearchParams({
     grant_type:'authorization_code',code:input.code,
     redirect_uri:app.redirectUri,client_id:app.clientId,code_verifier:tx.verifier,
    })
    const authorization='Basic '+Buffer.from(app.clientId+':'+app.clientSecret).toString('base64')
    const result=await fetchJSON(origin+'/application/o/token/',{
     method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
      Authorization:authorization},body:body.toString(),
    })
    if(result.token_type!=='Bearer')DENIED()
    const identity=await signedIdentity(app,result.id_token,tx.nonce)
    // Never return the token response, raw claims, verifier, client secret,
    // or any other credentials. App-specific session provisioning is separate.
    return {applicationId:app.id,identity}
   }catch{DENIED()}
  },
 })
}
