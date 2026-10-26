import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {createPublicOidcFlow} from './public-oidc.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const key={...publicKey.export({format:'jwk'}),kid:'provider-key',alg:'RS256',use:'sig'}
const origin='https://login.example.test',now=1793034000000
const clients=[
 {id:'friday',slug:'friday',clientId:'friday-web',clientSecret:'server-only-secret-a',
  redirectUri:'https://friday.example.test/auth/oidc/callback'},
 {id:'site',slug:'future-site',clientId:'future-web',clientSecret:'server-only-secret-b',
  redirectUri:'https://future.example.test/auth/callback'},
]
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url')
const issue=(claims={})=>{
 const signing=b64({alg:'RS256',kid:'provider-key',typ:'JWT'})+'.'+b64(claims)
 return signing+'.'+sign('RSA-SHA256',Buffer.from(signing),privateKey).toString('base64url')
}
function fixtures(overrides={}){
 const pending=new Map(),fetches=[],calls=[]
 let current=now
 const transactions={
  async reserve(tx){if(pending.has(tx.state))throw Error('collision');pending.set(tx.state,tx)},
  async consume(state){const tx=pending.get(state)||null;pending.delete(state);return tx},
 }
 const fetchImpl=async (url,options)=>{
  fetches.push({url,options})
  const slug=url.includes('/future-site/')?'future-site':'friday'
  const issuer=origin+'/application/o/'+slug+'/'
  if(url===issuer+'.well-known/openid-configuration')return {
   ok:true,json:async()=>overrides.discovery??{
    issuer,jwks_uri:issuer+'jwks/',
    authorization_endpoint:origin+'/application/o/authorize/',
    token_endpoint:origin+'/application/o/token/',
   },
  }
  if(url===issuer+'jwks/')return {ok:true,json:async()=>({keys:[key]})}
  if(url===origin+'/application/o/token/'){
   const form=new URLSearchParams(options.body)
   const tx=calls.at(-1)?.tx
   return {ok:true,json:async()=>({
    token_type:'Bearer',access_token:'server-only-access-token',
    id_token:issue({
     iss:tx.issuer,aud:tx.clientId,sub:'user-123',nonce:tx.nonce,
     iat:Math.floor(current/1000)-30,nbf:Math.floor(current/1000)-30,
     exp:Math.floor(current/1000)+600,...overrides.idClaims,
    }),
   })}
  }
  throw Error('unexpected network address')
 }
 const flow=createPublicOidcFlow({enabled:true,identityOrigin:origin,
  applications:clients,...overrides.config},{
   transactions,fetchImpl,now:()=>current,
  })
 const begin=async id=>{
  const start=await flow.begin({applicationId:id})
  const transaction=pending.get(new URL(start.authorizationUrl).searchParams.get('state'))
  calls.push({start,tx:transaction})
  return start
 }
 return {flow,begin,fetches,pending,calls,setNow:n=>{current=n}}
}

test('default disabled and invalid config never generate login or make network requests',async()=>{
 const disabled=createPublicOidcFlow()
 await assert.rejects(disabled.begin({applicationId:'friday'}),/sso-denied/)
 const f=fixtures({config:{enabled:false}})
 await assert.rejects(f.begin('friday'),/sso-denied/)
 assert.deepEqual(f.fetches,[])
})

test('two public apps share Authentik host but have isolated OIDC clients, issuers and exact redirects',async()=>{
 const f=fixtures()
 const friday=await f.begin('friday')
 const site=await f.begin('site')
 for(const [start,config,slug] of [[friday,clients[0],'friday'],[site,clients[1],'future-site']]){
  const url=new URL(start.authorizationUrl)
  assert.equal(url.origin,origin)
  assert.equal(url.pathname,'/application/o/authorize/')
  assert.equal(url.searchParams.get('response_type'),'code')
  assert.equal(url.searchParams.get('client_id'),config.clientId)
  assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri)
  assert.equal(url.searchParams.get('scope'),'openid profile email')
  assert.equal(url.searchParams.get('code_challenge_method'),'S256')
  assert.equal(url.searchParams.get('code_challenge').length,43)
  assert.equal(url.searchParams.get('nonce').length,43)
  assert.equal(url.searchParams.get('state').length,43)
  assert.equal(url.searchParams.has('code_verifier'),false)
  assert.equal(url.href.includes(config.clientSecret),false)
  assert.equal(start.applicationId,config.id)
  assert.equal(f.pending.get(url.searchParams.get('state')).issuer,origin+'/application/o/'+slug+'/')
 }
 assert.notEqual(new URL(friday.authorizationUrl).searchParams.get('state'),
  new URL(site.authorizationUrl).searchParams.get('state'))
 assert.equal(f.fetches.length,0)
})

test('Friday callback exchanges code through fixed token endpoint, validates signed ID token, no tokens returned',async()=>{
 const f=fixtures()
 const start=await f.begin('friday')
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 const result=await f.flow.complete({applicationId:'friday',state,code:'auth-code-123'})
 assert.equal(result.applicationId,'friday')
 assert.equal(result.identity.subject.startsWith('authentik:'),true)
 assert.equal(result.identity.subject.endsWith(':user-123'),true)
 assert.equal(result.identity.kind,'human')
 assert.equal(result.identity.expiresAtMs,now+600000)
 assert.equal(JSON.stringify(result).includes('server-only'),false)
 assert.equal(JSON.stringify(result).includes('id_token'),false)
 assert.deepEqual(f.fetches.map(x=>x.url),[
  origin+'/application/o/friday/.well-known/openid-configuration',
  origin+'/application/o/friday/jwks/',
  origin+'/application/o/token/',
 ])
 const call=f.fetches[2]
 const body=new URLSearchParams(call.options.body)
 assert.equal(body.get('grant_type'),'authorization_code')
 assert.equal(body.get('client_id'),'friday-web')
 assert.equal(body.get('redirect_uri'),clients[0].redirectUri)
 assert.equal(body.get('code'),'auth-code-123')
 assert.equal(body.get('code_verifier').length,43)
 assert.equal(call.options.headers.Authorization,'Basic '+Buffer.from('friday-web:server-only-secret-a').toString('base64'))
 assert.equal(call.options.redirect,'error')
})

test('future site returns separate app-scoped identity and exact confidential client exchange',async()=>{
 const f=fixtures()
 const start=await f.begin('site')
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 const result=await f.flow.complete({applicationId:'site',state,code:'other-code'})
 assert.equal(result.applicationId,'site')
 assert.equal(result.identity.subject.endsWith(':user-123'),true)
 const body=new URLSearchParams(f.fetches.at(-1).options.body)
 assert.equal(body.get('client_id'),'future-web')
 assert.equal(body.get('redirect_uri'),clients[1].redirectUri)
 assert.equal(f.fetches.at(-1).options.headers.Authorization,'Basic '+Buffer.from('future-web:server-only-secret-b').toString('base64'))
})

test('callback state is single-use, app-bound, expires after five minutes and never accepts arbitrary redirects',async()=>{
 const f=fixtures()
 const start=await f.begin('friday')
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 await assert.rejects(f.flow.complete({applicationId:'site',state,code:'code'}),/sso-denied/)
 await assert.rejects(f.flow.complete({applicationId:'friday',state,code:'code'}),/sso-denied/)
 const again=await f.begin('friday')
 const anotherState=new URL(again.authorizationUrl).searchParams.get('state')
 f.setNow(now+300001)
 await assert.rejects(f.flow.complete({applicationId:'friday',state:anotherState,code:'code'}),/sso-denied/)
 await assert.rejects(f.flow.begin({applicationId:'unknown',redirectUri:'https://evil.test/cb'}),/sso-denied/)
 assert.deepEqual(f.fetches,[])
})

test('tampered discovery, wrong issuer/audience/nonce and unsigned identity always deny',async()=>{
 for(const idClaims of [
  {iss:'https://evil.example.test/application/o/friday/'},
  {aud:'future-web'}, {nonce:'evil'},
  {exp:Math.floor(now/1000)-1}, {sub:''},
  {sub:'user 123'},{azp:'another-client'},
 ]){
  const f=fixtures({idClaims})
  const begin=await f.begin('friday')
  const state=new URL(begin.authorizationUrl).searchParams.get('state')
  await assert.rejects(f.flow.complete({applicationId:'friday',state,code:'code'}),/sso-denied/)
 }
 const f=fixtures({discovery:{issuer:origin+'/application/o/friday/',
  jwks_uri:'https://evil.example.test/keys',token_endpoint:origin+'/application/o/token/',
  authorization_endpoint:origin+'/application/o/authorize/'}})
 const start=await f.begin('friday')
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 await assert.rejects(f.flow.complete({applicationId:'friday',state,code:'code'}),/sso-denied/)
 assert.equal(f.fetches.length,1)
})

test('rejects untrusted client registration: duplicate IDs, shared secrets, http redirects and wildcard hosts',async()=>{
 const invalid=[
  [...clients,clients[0]],
  [{...clients[0],redirectUri:'http://friday.example.test/auth/oidc/callback'}],
  [{...clients[0],redirectUri:'https://*.example.test/auth/callback'}],
  [{...clients[0],redirectUri:'https://evil.test@friday.example.test/auth/callback'}],
  [{...clients[0],redirectUri:'https://friday.example.test/auth/oidc/callback?next=https://evil.test'}],
  [{...clients[0],redirectUri:'https://friday.example.test/auth/oidc/callback#token'}],
  [{...clients[0],clientSecret:''}],
  [{...clients[0],slug:'../friday'}],
  [{...clients[0],id:'friday'}, {...clients[1],id:'friday'}],
  [{...clients[0],clientId:clients[1].clientId},clients[1]],
 ]
 for(const apps of invalid){
  const f=fixtures({config:{applications:apps}})
  await assert.rejects(f.flow.begin({applicationId:'friday'}),/sso-denied/)
  assert.deepEqual(f.fetches,[])
 }
})

test('request token and state are never sourced from browser-supplied client ID, issuer, or return URL',async()=>{
 const f=fixtures()
 await assert.rejects(f.flow.begin({applicationId:'friday',
  issuer:'https://evil.test/application/o/friday/'}),/sso-denied/)
 const start=await f.begin('friday')
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 await assert.rejects(f.flow.complete({applicationId:'friday',state,code:'x',
  redirectUri:'https://evil.test'}),/sso-denied/)
 assert.deepEqual(f.fetches,[])
})
