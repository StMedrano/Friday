import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync, sign} from 'node:crypto'
import {createCloudflareAccessVerifier} from './cloudflare-access.mjs'

const issuer='https://test-team.cloudflareaccess.com'
const audience='test-friday-application-audience'
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...publicKey.export({format:'jwk'}),kid:'test-signing-key',use:'sig',alg:'RS256'}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
const now=1_780_000_000
const claims={iss:issuer,aud:[audience],exp:now+600,nbf:now-20,iat:now-30,email:'operator@example.test',sub:'actor-1',type:'app'}
function token(payload=claims,header={alg:'RS256',kid:jwk.kid,typ:'JWT'}){
 const raw=b64(header)+'.'+b64(payload)
 return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')
}
const fetcher=async(url,opts)=>{
 assert.equal(url,issuer+'/cdn-cgi/access/certs')
 assert.equal(opts.redirect,'error')
 return new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}})
}
const config={enabled:true,issuer,audience,publicOrigin:'https://friday.mytechtactics.com',operatorEmails:['operator@example.test']}
test('signed Access application JWT authorizes an identified user with correctly scoped issuer/audience',async()=>{
 const verify=createCloudflareAccessVerifier({fetchImpl:fetcher,now:()=>now*1000})
 const x=await verify({headers:{'cf-access-jwt-assertion':token()}},config)
 assert.deepEqual(x,{ok:true,email:'operator@example.test',operator:true})
})
test('anonymous, forged, wrong issuer, wrong aud, expired, future nbf, service token and alg none fail closed',async()=>{
 const v=createCloudflareAccessVerifier({fetchImpl:fetcher,now:()=>now*1000})
 for(const [name,t] of [
  ['missing',undefined],['forged',token().slice(0,-2)+'AA'],['issuer',token({...claims,iss:'https://evil.example'})],
  ['audience',token({...claims,aud:['wrong']})],['expired',token({...claims,exp:now-1})],
  ['future',token({...claims,nbf:now+100})],['service',token({...claims,email:undefined})],
  ['none',token(claims,{alg:'none',kid:jwk.kid})],['missing-sub',token({...claims,sub:''})],
  ['wrong-key',token(claims,{alg:'RS256',kid:'unknown'})]
 ]){
  const result=await v({headers:t?{'cf-access-jwt-assertion':t}:{}},config)
  assert.equal(result.ok,false,name)
 }
})
test('access configuration is fail-closed and cannot derive a JWKS URL from token-controlled claims',async()=>{
 let calls=0
 const v=createCloudflareAccessVerifier({fetchImpl:async()=>{calls++;throw Error('untrusted request')},now:()=>now*1000})
 for(const bad of [{...config,issuer:'https://malicious.example'}, {...config,audience:''}, {...config,issuer:'http://test-team.cloudflareaccess.com'}, {...config,issuer:'https://test-team.cloudflareaccess.com/path'}]){
  const x=await v({headers:{'cf-access-jwt-assertion':token()}},bad)
  assert.equal(x.ok,false)
  assert.equal(x.status,503)
 }
 assert.equal(calls,0)
})
test('JWKS failure denies authorization and never falls back to accepting JWT claims',async()=>{
 const v=createCloudflareAccessVerifier({fetchImpl:async()=>{throw new Error('network failure')},now:()=>now*1000})
 const x=await v({headers:{'cf-access-jwt-assertion':token()}},config)
 assert.equal(x.ok,false)
})
test('signed identity without operator email cannot perform privileged operations',async()=>{
 const v=createCloudflareAccessVerifier({fetchImpl:fetcher,now:()=>now*1000})
 const x=await v({headers:{'cf-access-jwt-assertion':token({...claims,email:'viewer@example.test'})}},config)
 assert.deepEqual(x,{ok:true,email:'viewer@example.test',operator:false})
})

test('cached signing keys never extend an identity past its exact expiry',async()=>{
 let time=now*1000,calls=0
 const v=createCloudflareAccessVerifier({now:()=>time,fetchImpl:async(...args)=>{calls++;return fetcher(...args)}})
 const request={headers:{'cf-access-jwt-assertion':token()}}
 assert.equal((await v(request,config)).ok,true)
 time=(claims.exp-1)*1000
 assert.equal((await v(request,config)).ok,true)
 const beforeExpiry=calls
 time=claims.exp*1000
 assert.deepEqual(await v(request,config),{ok:false,status:401,error:'access-identity-required'})
 assert.equal(calls,beforeExpiry,'expired identities must not trigger key retrieval')
})

test('unknown signing key refreshes only after cooldown and accepts a correctly signed rotated key',async()=>{
 const rotated=generateKeyPairSync('rsa',{modulusLength:2048})
 const next={...rotated.publicKey.export({format:'jwk'}),kid:'rotated-key',use:'sig',alg:'RS256'}
 const raw=b64({alg:'RS256',kid:next.kid})+'.'+b64(claims)
 const rotatedToken=raw+'.'+sign('RSA-SHA256',Buffer.from(raw),rotated.privateKey).toString('base64url')
 let time=now*1000,calls=0
 const v=createCloudflareAccessVerifier({now:()=>time,fetchImpl:async()=>{
  calls++
  return new Response(JSON.stringify({keys:calls===1?[jwk]:[next]}),{status:200})
 }})
 const original={headers:{'cf-access-jwt-assertion':token()}}
 const replacement={headers:{'cf-access-jwt-assertion':rotatedToken}}
 assert.equal((await v(original,config)).ok,true)
 assert.equal((await v(replacement,config)).status,401)
 assert.equal(calls,1)
 time+=29_999
 assert.equal((await v(replacement,config)).status,401)
 assert.equal(calls,1)
 time++
 assert.equal((await v(replacement,config)).ok,true)
 assert.equal(calls,2)
 assert.equal((await v(original,config)).status,401,'removed key must not remain trusted')
 assert.equal(calls,2)
})

test('expired JWKS cache fails closed during outage and recovers without trusting stale keys',async()=>{
 let time=now*1000,unavailable=false,calls=0
 const v=createCloudflareAccessVerifier({now:()=>time,fetchImpl:async(...args)=>{
  calls++
  if(unavailable)throw Error('synthetic JWKS outage')
  return fetcher(...args)
 }})
 const request={headers:{'cf-access-jwt-assertion':token()}}
 assert.equal((await v(request,config)).ok,true)
 time+=300_001
 unavailable=true
 assert.deepEqual(await v(request,config),{ok:false,status:503,error:'access-verification-unavailable'})
 unavailable=false
 assert.equal((await v(request,config)).ok,true)
 assert.equal(calls,3)
})

test('identity expiring during signing-key retrieval is rejected before authorization',async()=>{
 let time=now*1000
 const shortLived=token({...claims,exp:now+1})
 const v=createCloudflareAccessVerifier({now:()=>time,fetchImpl:async(...args)=>{
  const response=await fetcher(...args)
  time=(now+1)*1000
  return response
 }})
 assert.deepEqual(await v({headers:{'cf-access-jwt-assertion':shortLived}},config),
  {ok:false,status:401,error:'access-identity-required'})
})
