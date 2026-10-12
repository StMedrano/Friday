import {createPublicKey,verify} from 'node:crypto'

const base64url=/^[A-Za-z0-9_-]+$/
const domain=/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
const now=()=>Math.floor(Date.now()/1000)
const decode=part=>JSON.parse(Buffer.from(part,'base64url').toString('utf8'))

/**
 * Server-side Cloudflare Access assertion validation. This MUST NOT trust
 * spoofable CF identity headers without verifying the signed JWT.
 */
export function createAccessGate(config,{fetchImpl=fetch}={}){
 const teamDomain=String(config?.teamDomain||'').trim().replace(/\/$/,'')
 const audience=String(config?.audience||'').trim()
 const operators=config?.operatorEmails
 const isConfigured=domain.test(teamDomain)&&audience.length>=3&&audience.length<=256&&
  Array.isArray(operators)&&operators.every(s=>typeof s==='string'&&email.test(s.trim()))&&
  operators.length>0
 const allowedOperators=new Set(isConfigured?operators.map(x=>x.toLowerCase().trim()):[])
 let cachedKeys=null
 let cacheDeadline=0
 async function getKey(kid){
  if(!cachedKeys||Date.now()>=cacheDeadline){
   const result=await fetchImpl(teamDomain+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(5000)})
   if(!result.ok)throw Error('jwks-unavailable')
   const body=await result.json()
   if(!Array.isArray(body?.keys)||body.keys.length>16)throw Error('jwks-invalid')
   const entries=new Map()
   for(const item of body.keys){
    if(item?.kty!=='RSA'||item.alg!=='RS256'||item.use!=='sig'||typeof item.kid!=='string'||item.kid.length>256||!item.kid)continue
    try{entries.set(item.kid,createPublicKey({key:item,format:'jwk'}))}catch{}
   }
   if(!entries.size)throw Error('jwks-empty')
   cachedKeys=entries
   cacheDeadline=Date.now()+3600_000
  }
  return cachedKeys.get(kid)
 }
 return async function authorize(req,operatorOnly=false){
  if(!isConfigured)return {status:503,error:'access-not-configured'}
  const raw=req?.headers?.['cf-access-jwt-assertion']
  if(typeof raw!=='string'||raw.length>8192||raw.length<20)return {status:403,error:'access-denied'}
  const parts=raw.split('.')
  if(parts.length!==3||parts.some(s=>!base64url.test(s)))return {status:403,error:'access-denied'}
  try {
   const header=decode(parts[0])
   if(header?.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>256||!header.kid)return {status:403,error:'access-denied'}
   const key=await getKey(header.kid)
   if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))return {status:403,error:'access-denied'}
   const claims=decode(parts[1]),current=now()
   if(claims?.iss!==teamDomain||!(claims.aud===audience||(Array.isArray(claims.aud)&&claims.aud.includes(audience)))||
      !Number.isSafeInteger(claims.exp)||claims.exp<=current-30||
      (claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>current+30))||
      typeof claims.sub!=='string'||!claims.sub)return {status:403,error:'access-denied'}
   const userEmail=typeof claims.email==='string'?claims.email.toLowerCase().trim():''
   if(operatorOnly&&!allowedOperators.has(userEmail))return {status:403,error:'access-denied'}
   return {status:200,identity:{subject:claims.sub,email:userEmail}}
  } catch {
   return {status:403,error:'access-denied'}
  }
 }
}
