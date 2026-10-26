import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {createAuthentikAccessGate,authentikRoleSubject} from './authentik.mjs'

const TIME=1793034000000
const issuer='https://identity.example.test/application/o/friday/'
const clientId='friday-private-client'
const base={issuer,clientId,enabled:true}
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...publicKey.export({format:'jwk'}),kid:'ak-fixture',alg:'RS256',use:'sig'}
const subject='fe3318ab-3ed3-45cf-805b-ae4a7e75d377'
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
const request=(jwt)=>({headers:{authorization:'Bearer '+jwt}})
const token=(claims={},header={})=>{
 const payload={iss:issuer,aud:clientId,sub:subject,
  iat:Math.floor(TIME/1000)-30,nbf:Math.floor(TIME/1000)-30,
  exp:Math.floor(TIME/1000)+300,scope:'openid profile friday_control',
  email:'person@example.test',...claims}
 const signed=b64({alg:'RS256',kid:'ak-fixture',typ:'JWT',...header})+'.'+b64(payload)
 return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url')
}
function fixture(overrides={}){
 const seen=[]
 let current=TIME
 const metadata={issuer,jwks_uri:issuer+'jwks/'}
 const fetchImpl=async url=>{
  seen.push(url)
  if(url===issuer+'.well-known/openid-configuration')return {ok:true,json:async()=>overrides.discovery??metadata}
  if(url===issuer+'jwks/')return {ok:true,json:async()=>overrides.jwks??{keys:[jwk]}}
  throw Error('unexpected-request')
 }
 const gate=createAuthentikAccessGate({...base,...overrides.config},{
  fetchImpl,now:()=>current,
 })
 return {gate,seen,setTime:n=>{current=n}}
}

test('AuthentiK identity is default disabled, independently configured and never contacts discovery',async()=>{
 const f=fixture({config:{enabled:false}})
 assert.equal((await f.gate(request(token()))).status,503)
 assert.deepEqual(f.seen,[])
 const missing=createAuthentikAccessGate()
 assert.equal((await missing(request(token()))).status,503)
})

test('valid audience and exact issuer signed access token yields issuer-scoped human identity only',async()=>{
 const f=fixture()
 const result=await f.gate(request(token()))
 assert.equal(result.status,200)
 assert.equal(result.identity.kind,'human')
 assert.equal(result.identity.subject,authentikRoleSubject({issuer,sub:subject}))
 assert.equal(result.identity.email,'person@example.test')
 assert.equal(result.identity.expiresAtMs,TIME+300000)
 assert.equal(result.identity.subject.startsWith('authentik:'),true)
 assert.equal(result.identity.subject.includes(subject),true)
 assert.deepEqual(f.seen,[issuer+'.well-known/openid-configuration',issuer+'jwks/'])
 assert.equal((await f.gate(request(token()))).status,200)
 assert.equal(f.seen.length,2)
 assert.equal((await f.gate(request(token()),true)).status,403)
})

test('missing bearer, spoofed CF headers, malformed JWT, wrong scheme deny without fetch',async()=>{
 const f=fixture()
 for(const headers of [{},{'cf-access-authenticated-user-email':'admin@example.test'},
  {authorization:'Basic abc'}, {authorization:'Bearer x'}, {authorization:'Bearer foo.bar.baz'},
  {authorization:'Bearer '+token().slice(0,20)+'\n'} ]){
  assert.equal((await f.gate({headers})).status,403)
 }
 assert.deepEqual(f.seen,[])
})

test('invalid issuer, wrong audience, wrong signature, expired, future nbf, missing scope and service type deny',async()=>{
 const f=fixture()
 const bad=[
  token({iss:'https://evil.example.test/application/o/friday/'}),
  token({aud:'unrelated'}),
  token({aud:['friday-private-client','other-client']}),
  token({aud:['friday-private-client','other-client'],azp:'wrong'}),
  token({exp:Math.floor(TIME/1000)-1}),
  token({nbf:Math.floor(TIME/1000)+1000}),
  token({iat:Math.floor(TIME/1000)+1000}),
  token({iat:Math.floor(TIME/1000)-3600}),
  token({exp:Math.floor(TIME/1000)+3600}),
  token({scope:'openid profile email'}),
  token({scope:['openid','friday_control']}),
  token({sub:''}),
  token({sub:'other person'}),
  token({type:'service'}),
  token({}, {alg:'HS256'}),
  token({}, {kid:'wrong'}),
  token({}, {typ:'dpop+id_token'}),
  token().slice(0,-2)+'xx',
 ]
 for(const badJwt of bad){assert.equal((await f.gate(request(badJwt))).status,403)}
 assert.equal((await f.gate(request(token({aud:['friday-private-client','other-client'],azp:clientId})))).status,200)
})

test('discovery and signing key must be pinned to one exact issuer, no redirects or remote JWKS',async()=>{
 for(const discovery of [
  {issuer:'https://elsewhere.example.test/',jwks_uri:issuer+'jwks/'},
  {issuer,jwks_uri:'https://evil.example.test/jwks/'},
  {issuer,jwks_uri:'http://identity.example.test/application/o/friday/jwks/'},
  {issuer,jwks_uri:issuer+'jwks/?target=x'},
  {issuer},
 ]){
  const f=fixture({discovery})
  assert.equal((await f.gate(request(token()))).status,403)
  assert.deepEqual(f.seen,[issuer+'.well-known/openid-configuration'])
 }
 const invalid=fixture({jwks:{keys:[{...jwk,alg:'HS256'}]}})
 assert.equal((await invalid.gate(request(token()))).status,403)
})

test('invalid issuer configuration fails closed, rejecting localhost, http, global issuer and query',async()=>{
 for(const badIssuer of [
  'http://identity.example.test/application/o/friday/',
  'https://identity.example.test/',
  'https://localhost/application/o/friday/',
  'https://identity.example.test/application/o/friday/?x=1',
  'https://person:pass@identity.example.test/application/o/friday/',
  'https://identity.example.test/application/o/token/',
  'https://identity.example.test/application/o/friday/../../admin/',
 ]){
  const f=fixture({config:{issuer:badIssuer}})
  assert.equal((await f.gate(request(token()))).status,503)
  assert.deepEqual(f.seen,[])
 }
})

test('JWT expiry is re-evaluated on every call despite cached keys',async()=>{
 const f=fixture()
 assert.equal((await f.gate(request(token()))).status,200)
 f.setTime(TIME+300001)
 assert.equal((await f.gate(request(token()))).status,403)
 assert.equal(f.seen.length,2)
})

test('Role subject hashing binds stable sub to precise issuer, not email or a user-controlled group',()=>{
 const one=authentikRoleSubject({issuer,sub:subject})
 assert.equal(one,authentikRoleSubject({issuer,sub:subject}))
 assert.notEqual(one,authentikRoleSubject({issuer:'https://another.example.test/application/o/friday/',sub:subject}))
 assert.equal(authentikRoleSubject({issuer,sub:''}),null)
 assert.equal(authentikRoleSubject({issuer,sub:'other person'}),null)
 assert.equal(authentikRoleSubject({issuer:'http://identity.example.test/application/o/friday/',sub:subject}),null)
})
