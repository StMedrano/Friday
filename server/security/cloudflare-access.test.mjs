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
