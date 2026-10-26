import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,rename,rm,stat,chmod} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDormantHomeLabRuntime} from './homelab-safety-runtime.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const access={teamDomain:'https://fixture.cloudflareaccess.com',audience:'fixture-aud',
 operatorEmails:['operator@example.test','admin@example.test']}
const b64=data=>Buffer.from(JSON.stringify(data)).toString('base64url')
const request=(subject='operator-sub',email='operator@example.test')=>{
 const signed=b64({alg:'RS256',kid:'fixture'})+'.'+b64({
  iss:access.teamDomain,aud:access.audience,sub:subject,email,
  exp:Math.floor(Date.now()/1000)+600,
 })
 return {headers:{'cf-access-jwt-assertion':signed+'.'+sign('RSA-SHA256',
  Buffer.from(signed),privateKey).toString('base64url')}}
}
const operator=request()
const admin=request('admin-sub','admin@example.test')
const viewer=request('viewer-sub','viewer@example.test')
const keys=async()=>({ok:true,json:async()=>({keys:[{
 ...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig',
}]})})
const TIME=1793034000000
const policies=[
 {subject:'operator-sub',role:'Operator',targets:['staging-canary']},
 {subject:'admin-sub',role:'Administrator',targets:['staging-canary']},
 {subject:'viewer-sub',role:'Viewer',targets:['staging-canary']},
]
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'friday-home-safety-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const policyDir=join(root,'policy'),gateDir=join(root,'kill'),auditDirectory=join(root,'audit')
 await mkdir(policyDir,{mode:0o700})
 await mkdir(gateDir,{mode:0o700})
 const policyFilePath=join(policyDir,'roles.json'),gateFilePath=join(gateDir,'control.json')
 let time=TIME
 const role=async (bindings=policies,expiresAt=time+1800000)=>
  writeFile(policyFilePath,JSON.stringify({schemaVersion:1,expiresAt,bindings})+'\n',{mode:0o600})
 const arm=async (state='allow-approved-actions',expiresAt=time+120000)=>
  writeFile(gateFilePath,JSON.stringify({schemaVersion:1,state,expiresAt})+'\n',{mode:0o600})
 const options={
  enabled:true,access,auditDirectory,policyFilePath,gateFilePath,fetchKeys:keys,
  now:()=>time,diagnostics:{read:async()=>({status:'healthy'})},
  assistant:async()=>({provider:'fixture',text:'fixture healthy'}),
 }
 return {root,options,role,arm,setTime:n=>{time=n},auditDirectory,gateFilePath,policyFilePath}
}

test('default-disabled runtime does not create directories or enable HomeLab control',async t=>{
 const f=await fixture(t)
 const service=await createDormantHomeLabRuntime({
  ...f.options,enabled:false,
 })
 assert.equal(service.enabled,false)
 assert.equal(service.execute,undefined)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await assert.rejects(stat(f.auditDirectory),{code:'ENOENT'})
 assert.equal((await createDormantHomeLabRuntime()).enabled,false)
})

test('explicitly enabled dormant control still denies while kill and role files are missing',async t=>{
 const f=await fixture(t)
 const service=await createDormantHomeLabRuntime(f.options)
 assert.equal(service.enabled,true)
 assert.equal(service.execute,undefined)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await f.role()
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await f.arm()
 const proposal=await service.requestRestart(operator,{target:'staging-canary'})
 assert.equal(proposal.state,'pending-approval')
 assert.equal(proposal.execution.performed,false)
 await assert.rejects(service.requestRestart(viewer,{target:'staging-canary'}),/homelab-denied/)
 await assert.rejects(service.approveRestart(operator,{
  requestId:proposal.requestId,confirmation:proposal.confirmation,
 }),/homelab-denied/)
 const pending=await service.listPendingApprovals(admin,{limit:20})
 assert.equal(pending.items.length,1)
 assert.equal(pending.items[0].canApprove,true)
 assert.equal(JSON.stringify(pending).includes('operator-sub'),false)
 const approved=await service.approveRestart(admin,{
  requestId:proposal.requestId,confirmation:proposal.confirmation,
 })
 assert.equal(approved.execution.performed,false)
 assert.equal(approved.state,'approved-execution-unavailable')
 assert.equal(service.execute,undefined)
})

test('disarming or removing kill switch immediately blocks proposal, diagnostics and approvals',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 const proposal=await service.requestRestart(operator,{target:'staging-canary'})
 await f.arm('stopped')
 await assert.rejects(service.listPendingApprovals(admin,{limit:20}),/homelab-denied/)
 await assert.rejects(service.inspect(viewer,{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 await assert.rejects(service.approveRestart(admin,{requestId:proposal.requestId,
  confirmation:proposal.confirmation}),/homelab-denied/)
 await f.arm()
 assert.equal((await service.listPendingApprovals(admin,{limit:20})).items.length,1)
 await rm(f.gateFilePath)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
})

test('role downgrade, policy expiry and kill expiration deny without reconstructing runtime',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 assert.equal((await service.inspect(viewer,{target:'staging-canary',prompt:'Health'})).execution.performed,false)
 await f.role([{subject:'operator-sub',role:'Viewer',targets:['staging-canary']},policies[1],policies[2]])
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await f.role()
 await f.arm('allow-approved-actions',TIME+1000)
 f.setTime(TIME+1001)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await f.arm()
 await f.role(policies,TIME+1000)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
})

test('unsafe policy and kill file permissions, spoofed JWT and malformed options deny',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 await chmod(f.gateFilePath,0o644)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await chmod(f.gateFilePath,0o600)
 await chmod(f.policyFilePath,0o644)
 await assert.rejects(service.requestRestart(operator,{target:'staging-canary'}),/homelab-denied/)
 await chmod(f.policyFilePath,0o600)
 await assert.rejects(service.requestRestart({headers:{'x-friday-role':'Administrator'}},
  {target:'staging-canary'}),/homelab-denied/)
 await assert.rejects(createDormantHomeLabRuntime({
  ...f.options,policyFilePath:f.gateFilePath,
 }),/homelab-denied/)
 await assert.rejects(createDormantHomeLabRuntime({
  ...f.options,gateFilePath:'relative.json',
 }),/homelab-denied/)
})

test('revoked gate is checked after async diagnostic read before provider inference',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 let inference=0
 const service=await createDormantHomeLabRuntime({
  ...f.options,diagnostics:{read:async()=>{await f.arm('stopped');return {status:'healthy'}}},
  assistant:async()=>{inference++;return {text:'must not run'}},
 })
 await assert.rejects(service.inspect(viewer,{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 assert.equal(inference,0)
 assert.equal(service.execute,undefined)
})

test('dormant wired runtime supports terminal rejection or proposer withdrawal, not execution',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 const p=await service.requestRestart(operator,{target:'staging-canary'})
 const rejected=await service.rejectRestart(admin,{
  requestId:p.requestId,confirmation:'reject:'+p.requestId+':staging-canary:restart',
 })
 assert.equal(rejected.state,'rejected')
 assert.equal(rejected.execution.performed,false)
 await assert.rejects(service.approveRestart(admin,{
  requestId:p.requestId,confirmation:p.confirmation,
 }),/homelab-denied/)
 const p2=await service.requestRestart(operator,{target:'staging-canary'})
 const withdrawn=await service.withdrawRestart(operator,{
  requestId:p2.requestId,confirmation:p2.withdrawalConfirmation,
 })
 assert.equal(withdrawn.state,'withdrawn')
 assert.equal(withdrawn.execution.performed,false)
 assert.deepEqual((await service.listPendingApprovals(admin,{limit:20})).items,[])
 assert.equal(service.execute,undefined)
})

test('file-backed kill revocation denies finalizing pending requests even with signed identities',async t=>{
 const f=await fixture(t)
 await f.role()
 await f.arm()
 const service=await createDormantHomeLabRuntime(f.options)
 const p=await service.requestRestart(operator,{target:'staging-canary'})
 await f.arm('stopped')
 await assert.rejects(service.rejectRestart(admin,{
  requestId:p.requestId,confirmation:'reject:'+p.requestId+':staging-canary:restart',
 }),/homelab-denied/)
 await assert.rejects(service.withdrawRestart(operator,{
  requestId:p.requestId,confirmation:p.withdrawalConfirmation,
 }),/homelab-denied/)
 assert.equal(service.execute,undefined)
})
