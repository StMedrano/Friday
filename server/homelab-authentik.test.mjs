import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDormantHomeLabRuntime} from './homelab-safety-runtime.mjs'
import {authentikRoleSubject} from './security/authentik.mjs'

const TIME=1793034000000
const issuer='https://identity.example.test/application/o/friday/'
const clientId='friday-private-client'
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'}
const subs={operator:'operator-sub',admin:'admin-sub',viewer:'viewer-sub'}
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt=(sub,overrides={})=>{
 const payload={iss:issuer,aud:clientId,sub,iat:Math.floor(TIME/1000)-60,
  exp:Math.floor(TIME/1000)+300,scope:'openid friday_control',
  ...overrides}
 const signed=b64({alg:'RS256',kid:'fixture',typ:'JWT'})+'.'+b64(payload)
 return signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url')
}
const actor=(which,overrides={})=>({headers:{authorization:'Bearer '+jwt(subs[which],overrides)}})
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'friday-authentik-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const roleDir=join(root,'roles'),gateDir=join(root,'gate'),auditDirectory=join(root,'audit')
 await mkdir(roleDir,{mode:0o700})
 await mkdir(gateDir,{mode:0o700})
 const policyFilePath=join(roleDir,'roles.json'),gateFilePath=join(gateDir,'kill.json')
 let time=TIME
 const role=async()=>writeFile(policyFilePath,JSON.stringify({schemaVersion:1,
  expiresAt:TIME+3000000,bindings:[
   {subject:authentikRoleSubject({issuer,sub:subs.operator}),role:'Operator',targets:['staging-canary']},
   {subject:authentikRoleSubject({issuer,sub:subs.admin}),role:'Administrator',targets:['staging-canary']},
   {subject:authentikRoleSubject({issuer,sub:subs.viewer}),role:'Viewer',targets:['staging-canary']},
  ]})+'\n',{mode:0o600})
 const arm=async(state='allow-approved-actions')=>writeFile(gateFilePath,JSON.stringify({
  schemaVersion:1,state,expiresAt:TIME+300000,
 })+'\n',{mode:0o600})
 const fetchAuthentik=async url=>{
  if(url===issuer+'.well-known/openid-configuration')return {ok:true,json:async()=>({issuer,jwks_uri:issuer+'jwks/'})}
  if(url===issuer+'jwks/')return {ok:true,json:async()=>({keys:[jwk]})}
  throw Error('unknown-oidc-source')
 }
 return {role,arm,setTime:x=>{time=x},options:{
  enabled:true,identityProvider:'authentik',authentik:{enabled:true,issuer,clientId},
  fetchAuthentik,now:()=>time,auditDirectory,policyFilePath,gateFilePath,
  diagnostics:{read:async()=>({status:'healthy'})},
  assistant:async()=>({provider:'fixture',text:'diagnostics only'}),
 }}
}

test('default-disabled Authentik fixture creates no control even with configured Authentik',async t=>{
 const f=await fixture(t)
 const service=await createDormantHomeLabRuntime({...f.options,enabled:false})
 assert.equal(service.enabled,false)
 assert.equal(service.execute,undefined)
 await assert.rejects(service.requestRestart(actor('operator'),{target:'staging-canary'}),/homelab-denied/)
})

test('explicit Authentik issuer and role bindings allow symbolic proposals and separate human approval only',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 assert.equal(service.enabled,true)
 const proposal=await service.requestRestart(actor('operator'),{target:'staging-canary'})
 assert.equal(proposal.state,'pending-approval')
 assert.equal(proposal.execution.performed,false)
 assert.equal((await service.getRequestStatus(actor('operator'),{requestId:proposal.requestId})).state,'pending-approval')
 await assert.rejects(service.approveRestart(actor('operator'),{requestId:proposal.requestId,
  confirmation:proposal.confirmation}),/homelab-denied/)
 await assert.rejects(service.requestRestart(actor('viewer'),{target:'staging-canary'}),/homelab-denied/)
 const result=await service.approveRestart(actor('admin'),{
  requestId:proposal.requestId,confirmation:proposal.confirmation,
 })
 assert.equal(result.state,'approved-execution-unavailable')
 assert.equal(result.execution.performed,false)
 assert.equal(service.execute,undefined)
})

test('Authentik cannot fall back to spoofed Cloudflare identity or unscoped token',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 await assert.rejects(service.requestRestart({headers:{
  'cf-access-jwt-assertion':'spoofed','x-friday-role':'Administrator',
 }},{target:'staging-canary'}),/homelab-denied/)
 await assert.rejects(service.requestRestart(actor('operator',{scope:'openid profile'}),
  {target:'staging-canary'}),/homelab-denied/)
 await assert.rejects(service.requestRestart(actor('operator',{iss:'https://evil.example.test/'}),
  {target:'staging-canary'}),/homelab-denied/)
})

test('incompatible dual identity configuration and unsupported identity modes deny without fallback',async t=>{
 const f=await fixture(t)
 await assert.rejects(createDormantHomeLabRuntime({...f.options,access:{
  teamDomain:'https://team.cloudflareaccess.com',audience:'fixture',
  operatorEmails:['operator@example.test']},}),/homelab-denied/)
 await assert.rejects(createDormantHomeLabRuntime({...f.options,identityProvider:'none'}),/homelab-denied/)
 await assert.rejects(createDormantHomeLabRuntime({...f.options,authentik:{...f.options.authentik,enabled:false}}),/homelab-denied/)
})

test('Authentik session expires during asynchronous diagnostic read and prevents AI inference',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 let calls=0
 const service=await createDormantHomeLabRuntime({...f.options,
  diagnostics:{read:async()=>{f.setTime(TIME+61000);return {status:'healthy'}}},
  assistant:async()=>{calls++;return {text:'do not infer'}},
 })
 await assert.rejects(service.inspect(actor('viewer',{exp:Math.floor(TIME/1000)+60}),
  {target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 assert.equal(calls,0)
 assert.equal(service.execute,undefined)
})

test('kill file revocation still supersedes valid Authentik signed subject grants',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 await f.arm('stopped')
 await assert.rejects(service.requestRestart(actor('operator'),{target:'staging-canary'}),/homelab-denied/)
 assert.equal(service.execute,undefined)
})
