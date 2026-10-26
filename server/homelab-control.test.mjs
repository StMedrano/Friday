import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generateKeyPairSync, sign} from 'node:crypto'
import * as control from './homelab-control.mjs'
import * as audit from './homelab-audit.mjs'
import {answerAssistant} from './assistant.mjs'
import {createOperatorRolePolicy} from './security/operator-policy.mjs'

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const access={teamDomain:'https://fixture.cloudflareaccess.com',audience:'fixture-aud',operatorEmails:['operator@example.test']}
const roles=createOperatorRolePolicy({bindings:[
 {subject:'operator@example.test',role:'Operator',targets:['staging-canary']},
 {subject:'admin@example.test',role:'Administrator',targets:['staging-canary']},
 {subject:'viewer@example.test',role:'Viewer',targets:['staging-canary']},
 {subject:'agent@example.test',role:'Friday Agent',targets:['staging-canary']},
]})
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
function request(email='operator@example.test') {
 const payload=b64({alg:'RS256',kid:'fixture'})+'.'+b64({iss:access.teamDomain,aud:access.audience,sub:email,email,exp:Math.floor(Date.now()/1000)+600})
 return {headers:{'cf-access-jwt-assertion':payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')}}
}
async function fixture(t, overrides={}) {
 const directory=await mkdtemp(join(tmpdir(),'friday-tools-'))
 t.after(()=>rm(directory,{recursive:true,force:true}))
 const store=await audit.createHomeLabAudit({directory})
 const calls=[]
 let enabled=true
 const service=control.createHomeLabControl({enabled:true,access,store,rolePolicy:roles,
  automationAllowed:()=>enabled,
  fetchKeys:async()=>({ok:true,json:async()=>({keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'}]})}),
  diagnostics:{read:async(target)=>{calls.push(target);return {status:'healthy',rawSecret:'must-not-forward'}}},
  assistant:async(input)=>answerAssistant({...input,providers:{groq:async({overview})=>{
   assert.equal(JSON.stringify(overview).includes('must-not-forward'),false)
   assert.equal(overview.services[0].id,'staging-canary')
   return {provider:'groq',model:'fixture-model',text:'Fixture is healthy.'}
  }}}),
  config:{ai:{enabled:true,providerOrder:['groq'],providers:{groq:{apiKey:'synthetic-fixture',model:'fixture-model'}}}},
  ...overrides})
 return {service,store,directory,calls,kill:()=>{enabled=false}}
}

test('foundation exports are present',()=>{
 assert.equal(typeof control.createHomeLabControl,'function')
 assert.equal(typeof audit.createHomeLabAudit,'function')
})

test('signed operator diagnostics feed normalized evidence through existing sequential assistant seam',async t=>{
 const f=await fixture(t)
 const result=await f.service.inspect(request(),{target:'staging-canary',prompt:'Describe health'})
 assert.equal(result.provider,'groq')
 assert.equal(result.model,'fixture-model')
 assert.equal(result.execution.performed,false)
 assert.deepEqual(f.calls,['staging-canary'])
 const records=await Promise.all((await readdir(f.directory)).map(file=>readFile(join(f.directory,file),'utf8')))
 assert.equal(records.length,2)
 assert.match(records.join(''),/diagnostic-started/)
 assert.match(records.join(''),/diagnostic-completed/)
 assert.doesNotMatch(records.join(''),/synthetic-fixture|must-not-forward|jwt|operator@example|Describe health/)
})

test('default disabled, kill switch, missing identity, viewer and wrong target deny before diagnostic or inference',async t=>{
 for(const [overrides,req,input] of [
  [{enabled:false},request(),{target:'staging-canary',prompt:'Health'}],
  [{automationAllowed:()=>false},request(),{target:'staging-canary',prompt:'Health'}],
  [{}, {headers:{}},{target:'staging-canary',prompt:'Health'}],
  [{},request('stranger@example.test'),{target:'staging-canary',prompt:'Health'}],
  [{},request(),{target:'production',prompt:'Health'}],
  [{},request(),{target:'staging-canary',prompt:'Health',command:'restart'}],
 ]) {
  let inference=0
  const f=await fixture(t,{...overrides,assistant:async()=>{inference++}})
  await assert.rejects(f.service.inspect(req,input),/homelab-denied/)
  assert.equal(f.calls.length,0);assert.equal(inference,0)
 }
 assert.equal(control.createHomeLabControl().enabled,false)
})

test('restart request persists, requires exact operator confirmation, reloads, and never executes',async t=>{
 const f=await fixture(t)
 const proposal=await f.service.requestRestart(request(),{target:'staging-canary'})
 assert.equal(proposal.state,'pending-approval')
 assert.equal(proposal.execution.performed,false)
 assert.equal(f.service.execute,undefined)
 await assert.rejects(f.service.approveRestart(request(),{requestId:proposal.requestId,confirmation:'yes'}),/homelab-denied/)
 await assert.rejects(f.service.approveRestart(request('viewer@example.test'),{requestId:proposal.requestId,confirmation:proposal.confirmation}),/homelab-denied/)
 const reloaded=await fixture(t,{store:await audit.createHomeLabAudit({directory:f.directory})})
 const approved=await reloaded.service.approveRestart(request('admin@example.test'),{requestId:proposal.requestId,confirmation:proposal.confirmation})
 assert.equal(approved.state,'approved-execution-unavailable')
 assert.equal(approved.execution.performed,false)
 await assert.rejects(f.service.approveRestart(request('admin@example.test'),{requestId:proposal.requestId,confirmation:proposal.confirmation}),/homelab-denied/)
 assert.deepEqual(f.calls,[])
})

test('concurrent approvals create one immutable durable approval and kill switch prevents later approvals',async t=>{
 const f=await fixture(t)
 const p=await f.service.requestRestart(request(),{target:'staging-canary'})
 const input={requestId:p.requestId,confirmation:p.confirmation}
 const results=await Promise.allSettled([f.service.approveRestart(request('admin@example.test'),input),f.service.approveRestart(request('admin@example.test'),input)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 const p2=await f.service.requestRestart(request(),{target:'staging-canary'})
 f.kill()
 await assert.rejects(f.service.approveRestart(request('admin@example.test'),{requestId:p2.requestId,confirmation:p2.confirmation}),/homelab-denied/)
})

test('expired or malformed durable requests fail closed',async t=>{
 let time=Date.now()
 const f=await fixture(t,{now:()=>time})
 const p=await f.service.requestRestart(request(),{target:'staging-canary'})
 time+=300001
 await assert.rejects(f.service.approveRestart(request('admin@example.test'),{requestId:p.requestId,confirmation:p.confirmation}),/homelab-denied/)
 const p2=await f.service.requestRestart(request(),{target:'staging-canary'})
 await writeFile(join(f.directory,p2.requestId+'.restart-requested.json'),'{truncated')
 await assert.rejects(f.service.approveRestart(request('admin@example.test'),{requestId:p2.requestId,confirmation:p2.confirmation}),/homelab-denied/)
})

test('unavailable audit blocks diagnostics before reads; completion failure never reports success',async t=>{
 const bad={append:async()=>{throw Error('storage secret')},read:async()=>null}
 const f=await fixture(t,{store:bad})
 await assert.rejects(f.service.inspect(request(),{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 assert.deepEqual(f.calls,[])
 let writes=0
 const g=await fixture(t,{store:{...bad,append:async()=>{if(++writes>1)throw Error('disk full')}}})
 await assert.rejects(g.service.inspect(request(),{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
})

test('diagnostic errors and malformed evidence never reach a provider and are audited without raw errors',async t=>{
 for(const read of [async()=>{throw Error('private endpoint secret')},async()=>({status:'invented'})]) {
  let calls=0
  const f=await fixture(t,{diagnostics:{read},assistant:async()=>{calls++}})
  await assert.rejects(f.service.inspect(request(),{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
  assert.equal(calls,0)
  const records=await Promise.all((await readdir(f.directory)).map(file=>readFile(join(f.directory,file),'utf8')))
  assert.match(records.join(''),/diagnostic-failed/)
  assert.doesNotMatch(records.join(''),/private endpoint secret/)
 }
})

test('disabled or killed control does not retrieve signing keys',async t=>{
 for(const overrides of [{enabled:false},{automationAllowed:()=>false}]){
  let calls=0
  const f=await fixture(t,{...overrides,fetchKeys:async()=>{calls++;throw Error('must not fetch')}})
  await assert.rejects(f.service.requestRestart(request(),{target:'staging-canary'}),/homelab-denied/)
  assert.equal(calls,0)
 }
})

test('a stalled diagnostic is bounded even if its fake ignores the abort signal',async t=>{
 const f=await fixture(t,{diagnosticTimeoutMs:10,diagnostics:{read:async()=>new Promise(()=>{})}})
 const result=await Promise.race([
  f.service.inspect(request(),{target:'staging-canary',prompt:'Health'}).then(()=> 'success',()=> 'denied'),
  new Promise(resolve=>setTimeout(()=>resolve('stalled'),100)),
 ])
 assert.equal(result,'denied')
})

test('kill during diagnostics prevents subsequent model inference',async t=>{
 let inference=0
 let f
 f=await fixture(t,{diagnostics:{read:async()=>{f.kill();return {status:'healthy'}}},assistant:async()=>{inference++}})
 await assert.rejects(f.service.inspect(request(),{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 assert.equal(inference,0)
})

test('role policy gates trusted read-only diagnostics and excludes viewers/agents from proposal',async t=>{
 const f=await fixture(t)
 for(const who of ['viewer@example.test','agent@example.test']){
  const result=await f.service.inspect(request(who),{target:'staging-canary',prompt:'Health'})
  assert.equal(result.execution.performed,false)
  await assert.rejects(f.service.requestRestart(request(who),{target:'staging-canary'}),/homelab-denied/)
 }
 assert.deepEqual(f.calls,['staging-canary','staging-canary'])
})

test('role policy is mandatory, ignores client headers and requires a separate administrator to approve',async t=>{
 const absent=await fixture(t,{rolePolicy:null})
 await assert.rejects(absent.service.inspect(request(),{target:'staging-canary',prompt:'Health'}),/homelab-denied/)
 assert.deepEqual(absent.calls,[])
 const f=await fixture(t)
 const p=await f.service.requestRestart(request(),{target:'staging-canary'})
 assert.equal(p.execution.performed,false)
 for(const who of ['operator@example.test','viewer@example.test','agent@example.test']){
  await assert.rejects(f.service.approveRestart(request(who),{
   requestId:p.requestId,confirmation:p.confirmation,
  }),/homelab-denied/)
 }
 await assert.rejects(f.service.approveRestart({...request(),headers:{
  ...request().headers,'x-friday-role':'Administrator',
 }},{requestId:p.requestId,confirmation:p.confirmation}),/homelab-denied/)
 const approved=await f.service.approveRestart(request('admin@example.test'),{
  requestId:p.requestId,confirmation:p.confirmation,
 })
 assert.equal(approved.state,'approved-execution-unavailable')
 assert.equal(approved.execution.performed,false)
 assert.equal(f.service.execute,undefined)
})

test('administrator cannot self approve a staging proposal even with the correct confirmation',async t=>{
 const f=await fixture(t)
 const p=await f.service.requestRestart(request('admin@example.test'),{target:'staging-canary'})
 await assert.rejects(f.service.approveRestart(request('admin@example.test'),{
  requestId:p.requestId,confirmation:p.confirmation,
 }),/homelab-denied/)
 assert.equal(await f.store.read(p.requestId,'restart-approved'),null)
})
