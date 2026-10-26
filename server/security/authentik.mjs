import {createHash,createPublicKey,verify} from 'node:crypto'

const JWT_PART=/^[A-Za-z0-9_-]+$/
const SLUG=/^[a-z0-9][a-z0-9-]{0,62}$/
const SUB=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/
const CLIENT=/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_MAX_AGE_SECONDS=900
const JWKS_CACHE_MS=300000
const deny=()=>({status:403,error:'authentik-denied'})

function validIssuer(issuer) {
 if(typeof issuer!=='string'||issuer.length>512)return false
 try {
  const url=new URL(issuer)
  const names=url.hostname.split('.')
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&
   !url.hash&&!url.port&&url.href===issuer&&names.length>=2&&
   names.every(part=>SLUG.test(part))&&!['localhost','local'].includes(names.at(-1))&&
   /^\/application\/o\/[a-z0-9][a-z0-9-]{0,62}\/$/.test(url.pathname)&&
   !['authorize','token','userinfo','jwks','revoke','introspect','device'].includes(
    url.pathname.split('/')[3])
 }catch{return false}
}

// Own the subject's namespace. Cloudflare Access subjects and Authentik subs
// must never share authorization or approval identities merely because they
// have the same email or raw sub value.
export function authentikRoleSubject({issuer,sub}={}) {
 if(!validIssuer(issuer)||typeof sub!=='string'||!SUB.test(sub))return null
 const issuerKey=createHash('sha256').update(issuer).digest('hex').slice(0,16)
 return `authentik:${issuerKey}:${sub}`
}

/**
 * INTERNAL / OPT-IN ONLY. Verify an Authentik OIDC provider's RSA-signed
 * dedicated Friday access-token scope. This is NOT a login-flow handler,
 * browser session, HTTP route, production identity fallback, or role mapper.
 * The verified issuer-scoped human subject must independently match an
 * owner-private role file and pass the global kill gate.
 *
 * Recommended Authentik provider: per-application issuer, RS256 Signing Key,
 * short-lived access tokens, explicit 'friday_control' OAuth scope mapping.
 * HS256 providers are deliberately unsupported.
 */
export function createAuthentikAccessGate(config={},{
 fetchImpl=fetch,now=Date.now,
}={}) {
 const issuer=config?.issuer
 const clientId=config?.clientId
 const configured=config?.enabled===true&&validIssuer(issuer)&&
  typeof clientId==='string'&&CLIENT.test(clientId)&&
  typeof now==='function'&&typeof fetchImpl==='function'
 const discoveryUrl=configured?issuer+'.well-known/openid-configuration':null
 const jwksUrl=configured?issuer+'jwks/':null
 let keyCache=null
 let cacheDeadline=0
 const fetchJSON=async url=>{
  const result=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(5000)})
  if(!result?.ok)throw Error('oidc-unavailable')
  const body=await result.json()
  if(!body||typeof body!=='object'||Array.isArray(body)||
     JSON.stringify(body).length>16384)throw Error('oidc-invalid')
  return body
 }
 async function signingKey(kid,at){
  if(!keyCache||at>=cacheDeadline){
   // Never take authority or a fetched URL from an untrusted JWT, issuer
   // claim, redirect, request header, or discovery document.
   const discovery=await fetchJSON(discoveryUrl)
   if(discovery.issuer!==issuer||discovery.jwks_uri!==jwksUrl)throw Error('oidc-discovery')
   const jwks=await fetchJSON(jwksUrl)
   if(!Array.isArray(jwks.keys)||jwks.keys.length<1||jwks.keys.length>16)throw Error('oidc-jwks')
   const entries=new Map()
   for(const key of jwks.keys){
    if(key?.kty!=='RSA'||key.alg!=='RS256'||key.use!=='sig'||
       typeof key.kid!=='string'||key.kid.length>128||
       !JWT_PART.test(key.kid)||entries.has(key.kid))throw Error('oidc-key')
    entries.set(key.kid,createPublicKey({key,format:'jwk'}))
   }
   keyCache=entries
   cacheDeadline=at+JWKS_CACHE_MS
  }
  return keyCache.get(kid)
 }
 return async function authorize(request,operatorOnly=false) {
  if(!configured)return {status:503,error:'authentik-not-configured'}
  // Do not reuse this gate for unrelated Cloudflare operator-only routes.
  if(operatorOnly)return deny()
  const raw=request?.headers?.authorization
  if(typeof raw!=='string'||!raw.startsWith('Bearer ')||raw.length>8192)return deny()
  const token=raw.slice(7),parts=token.split('.')
  if(parts.length!==3||parts.some(v=>!v||!JWT_PART.test(v)))return deny()
  try{
   const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))
   const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'))
   const atMs=now()
   const nowSec=Math.floor(atMs/1000)
   const identitySub=authentikRoleSubject({issuer,sub:claims.sub})
   if(header?.alg!=='RS256'||(header.typ!==undefined&&
      !['JWT','at+jwt'].includes(header.typ))||typeof header.kid!=='string'||
      header.kid.length>128||!JWT_PART.test(header.kid)||
      !Number.isSafeInteger(atMs)||atMs<0||
      claims?.iss!==issuer||!identitySub||claims.type==='app'||claims.type==='service'||
      !(claims.aud===clientId||(Array.isArray(claims.aud)&&claims.aud.includes(clientId)))||
      (Array.isArray(claims.aud)&&claims.aud.length>1&&claims.azp!==clientId)||
      (claims.azp!==undefined&&claims.azp!==clientId)||
      !Number.isSafeInteger(claims.exp)||!Number.isSafeInteger(claims.iat)||
      claims.exp<=nowSec||claims.iat>nowSec||
      claims.exp<=claims.iat||claims.exp-claims.iat>TOKEN_MAX_AGE_SECONDS||
      (claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>nowSec))||
      typeof claims.scope!=='string'||!claims.scope.split(' ').includes('friday_control'))
     return deny()
   const key=await signingKey(header.kid,atMs)
   if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),
      key,Buffer.from(parts[2],'base64url')))return deny()
   const email=typeof claims.email==='string'&&EMAIL.test(claims.email)?
      claims.email.toLowerCase():''
   return {status:200,identity:{
    kind:'human',subject:identitySub,email,expiresAtMs:claims.exp*1000,
   }}
  }catch{return deny()}
 }
}
