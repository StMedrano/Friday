import {createPublicKey, verify as verifySignature} from 'node:crypto'

const MAX_TOKEN_LENGTH=8192
const MAX_JWKS_LENGTH=100_000
const VALID_ISSUER=/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/
const VALID_AUDIENCE=/^[A-Za-z0-9_-]{12,128}$/
const VALID_KID=/^[A-Za-z0-9_-]{1,256}$/
const INVALID={ok:false,status:401,error:'access-identity-required'}
const UNCONFIGURED={ok:false,status:503,error:'access-unconfigured'}
const SERVICE_UNAVAILABLE={ok:false,status:503,error:'access-verification-unavailable'}

function parsePart(text) {
 if(typeof text!=='string'||!text||! /^[A-Za-z0-9_-]+$/.test(text))throw Error('invalid-jwt')
 const b=Buffer.from(text,'base64url')
 if(b.toString('base64url')!==text)throw Error('invalid-jwt')
 return JSON.parse(b.toString('utf8'))
}
function validConfig(c){
 return c&&c.enabled===true&&typeof c.issuer==='string'&&VALID_ISSUER.test(c.issuer)&&
 typeof c.audience==='string'&&VALID_AUDIENCE.test(c.audience)&&Array.isArray(c.operatorEmails)&&typeof c.publicOrigin==='string'&& /^https:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?$/.test(c.publicOrigin)
}
async function readLimited(response) {
 const contentLength=Number(response.headers.get('content-length')||0)
 if(contentLength>MAX_JWKS_LENGTH)throw Error('jwks-too-large')
 if(!response.ok)throw Error('jwks-unavailable')
 let text=''
 if(!response.body)throw Error('jwks-empty')
 for await (const piece of response.body){
  text+=Buffer.from(piece).toString('utf8')
  if(text.length>MAX_JWKS_LENGTH)throw Error('jwks-too-large')
 }
 const parsed=JSON.parse(text)
 if(!Array.isArray(parsed.keys)||parsed.keys.length>20)throw Error('jwks-invalid')
 return parsed.keys.filter(k=>k&&k.kty==='RSA'&&(k.use===undefined||k.use==='sig')&&(k.alg===undefined||k.alg==='RS256')&&VALID_KID.test(k.kid)&&typeof k.n==='string'&&typeof k.e==='string')
}
/**
 * Validate signed Cloudflare Access application JWTs at origin, not untrusted
 * user headers. Config is fixed at boot; issuer controls the fixed JWKS URL.
 * Does not log tokens or expose claims in denial responses.
 */
export function createCloudflareAccessVerifier({fetchImpl=fetch,now=()=>Date.now()}={}){
 const cache=new Map()
 return async function verifyAccess(request,configuration){
  if(!validConfig(configuration))return UNCONFIGURED
  const raw=request?.headers?.['cf-access-jwt-assertion']
  if(typeof raw!=='string'||raw.length>MAX_TOKEN_LENGTH)return INVALID
  const parts=raw.split('.')
  if(parts.length!==3)return INVALID
  let header,payload
  try {
   header=parsePart(parts[0]);payload=parsePart(parts[1])
   if(!header||header.alg!=='RS256'||!VALID_KID.test(header.kid)||!payload||typeof payload!=='object')return INVALID
   const seconds=Math.floor(now()/1000)
   if(payload.iss!==configuration.issuer||!Array.isArray(payload.aud)||!payload.aud.includes(configuration.audience)||
      !Number.isSafeInteger(payload.iat)||!Number.isSafeInteger(payload.exp)||!Number.isSafeInteger(payload.nbf)||
      payload.iat>seconds+60||payload.exp<=seconds||payload.nbf>seconds||payload.exp<=payload.iat||
      payload.exp-payload.iat>86400||payload.type!=='app'||typeof payload.sub!=='string'||!payload.sub||
      typeof payload.email!=='string'||payload.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)||
      payload.service_token_id!==undefined)return INVALID

   let keys=cache.get(configuration.issuer)
   if(!keys||keys.expires<now()||(!keys.value.some(k=>k.kid===header.kid)&&keys.fetchedAt+30_000<=now())){
    const url=configuration.issuer+'/cdn-cgi/access/certs'
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(3000),redirect:'error'})
    keys={value:await readLimited(response),expires:now()+300_000,fetchedAt:now()}
    cache.set(configuration.issuer,keys)
   }
   const match=keys.value.find(k=>k.kid===header.kid)
   if(!match)return INVALID
   const signature=Buffer.from(parts[2],'base64url')
   if(signature.toString('base64url')!==parts[2])return INVALID
   const valid=verifySignature('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:match,format:'jwk'}),signature)
   if(!valid)return INVALID
   // Key retrieval may outlast the identity; check expiry at authorization time.
   if(payload.exp<=Math.floor(now()/1000))return INVALID
   const email=payload.email.toLowerCase()
   return {ok:true,email,operator:configuration.operatorEmails.includes(email)&&payload.custom?.friday_auth_source==='authentik'}
  }catch{return SERVICE_UNAVAILABLE}
 }
}
