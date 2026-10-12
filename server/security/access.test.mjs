import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {createAccessGate} from './access.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...publicKey.export({format:'jwk'}),kid:'test-kid',alg:'RS256',use:'sig'}
const cfg={enabled:true,teamDomain:'https://team.cloudflareaccess.com',audience:'friday-aud',operatorEmails:['operator@example.test']}
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
function token(claims={},header={}){
 const payload={iss:cfg.teamDomain,aud:[cfg.audience],exp:Math.floor(Date.now()/1000)+600,nbf:Math.floor(Date.now()/1000)-60,sub:'subject',email:'operator@example.test',...claims}
 const signingInput=b64({alg:'RS256',typ:'JWT',kid:'test-kid',...header})+'.'+b64(payload)
 return signingInput+'.'+sign('RSA-SHA256',Buffer.from(signingInput),privateKey).toString('base64url')
}
function gate(overrides={}){
 let calls=0
 const fetchImpl=async(url)=>{calls++;assert.equal(url,'https://team.cloudflareaccess.com/cdn-cgi/access/certs');return {ok:true,json:async()=>({keys:[jwk]})}}
 return {guard:createAccessGate({...cfg,...overrides},{fetchImpl}),count:()=>calls}
}
test('missing and invalid tokens deny, no network on missing token',async()=>{
 const {guard,count}=gate()
 assert.deepEqual((await guard({headers:{}},false)).status,403)
 assert.equal(count(),0)
 assert.equal((await guard({headers:{'cf-access-jwt-assertion':'fake.token.sig'}},false)).status,403)
})
test('signed Access token authorizes reads, operator email authorizes registry sync',async()=>{
 const {guard,count}=gate()
 const headers={'cf-access-jwt-assertion':token()}
 assert.equal((await guard({headers},false)).status,200)
 assert.equal((await guard({headers},true)).status,200)
 assert.equal(count(),1)
})
test('bad issuer, audience, expiry, future nbf, algorithm, unknown key and tampering denied',async()=>{
 for(const t of [
  token({iss:'https://attacker.cloudflareaccess.com'}),token({aud:['another-app']}),
  token({exp:0}),token({nbf:Math.floor(Date.now()/1000)+3600}),
  token({}, {alg:'HS256'}),token({}, {kid:'wrong'}),token().slice(0,-5)+'xxxxx',
 ]){
  const {guard}=gate()
  assert.equal((await guard({headers:{'cf-access-jwt-assertion':t}},false)).status,403)
 }
})
test('valid nonoperator token never authorizes registry mutation',async()=>{
 const {guard}=gate()
 const headers={'cf-access-jwt-assertion':token({email:'another@example.test'})}
 assert.equal((await guard({headers},false)).status,200)
 assert.equal((await guard({headers},true)).status,403)
})
test('missing or malformed configuration fails closed with 503',async()=>{
 for(const conf of [{audience:''},{teamDomain:'http://team.cloudflareaccess.com'},{teamDomain:'https://attacker.example'},{operatorEmails:['']}]) {
  const {guard}=gate(conf)
  assert.equal((await guard({headers:{'cf-access-jwt-assertion':token()}},false)).status,503)
 }
})

test('Access JWT audience may be a single RFC 7519 string',async()=>{
 const {guard}=gate()
 assert.equal((await guard({headers:{'cf-access-jwt-assertion':token({aud:cfg.audience})}},false)).status,200)
})
