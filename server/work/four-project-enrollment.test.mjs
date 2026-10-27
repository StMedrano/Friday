import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileWorkSubjectGrants} from './file-subject-grants.mjs'
import {FOUR_PROJECT_KEYS,createFourProjectEnrollment} from './four-project-enrollment.mjs'

const NOW=1793100000000
const SUBJECT='12345678-1234-4234-9234-123456789abc'
const projectIds={
 'friday-ai-os':'verified-friday-project',
 'techtactics':'verified-techtactics-project',
 'web-growth-agents':'verified-growth-project',
 'app-builder':'verified-builder-project',
}
const build=(values={})=>createFourProjectEnrollment({
 verifiedAccessSub:SUBJECT,
 verifiedProjectIds:projectIds,
 expiresAt:NOW+3600000,
 now:NOW,
 ...values,
})

test('selected four projects resolve only from owner-verified exact database IDs, with read-only memory scopes',()=>{
 assert.deepEqual(FOUR_PROJECT_KEYS,['friday-ai-os','techtactics','web-growth-agents','app-builder'])
 const policy=build()
 assert.deepEqual(Object.keys(policy),['schemaVersion','expiresAt','users'])
 assert.equal(policy.schemaVersion,1)
 assert.equal(policy.expiresAt,NOW+3600000)
 assert.equal(policy.users.length,1)
 const enrolled=policy.users[0]
 assert.match(enrolled.subjectHash,/^[a-f0-9]{64}$/)
 assert.equal(JSON.stringify(policy).includes(SUBJECT),false)
 assert.deepEqual(enrolled.allowedProjectIds,Object.values(projectIds))
 assert.deepEqual(enrolled.allowedMemoryScopes,Object.values(projectIds).map(ownerId=>({
  scope:'project',ownerId,
 })))
 assert.deepEqual(Object.keys(enrolled),['subjectHash','allowedProjectIds','allowedMemoryScopes'])
 assert.equal(JSON.stringify(policy).includes('execute'),false)
 assert.equal(JSON.stringify(policy).includes('role'),false)
 assert.equal(JSON.stringify(policy).includes('Administrator'),false)
})

test('never infer project IDs from display names, group names, guessed slugs, wildcards or partial mapping',()=>{
 for(const mapping of [
  undefined,{},[],
  {...projectIds,'app-builder':undefined},
  {...projectIds,'app-builder':'*'},
  {...projectIds,'app-builder':'techtactics-project','techtactics':'techtactics-project'},
  {...projectIds,homelab:'unauthorized'},
  {...projectIds,'web-growth-agents':''},
  {...projectIds,'friday-ai-os':' ../etc/passwd'},
  {...projectIds,'friday-ai-os':'foo@example.test'},
 ]){
  assert.throws(()=>build({verifiedProjectIds:mapping}),/four-project-enrollment-denied/)
 }
})

test('must bind an actual Access UUID, not an email address, arbitrary actor or token',()=>{
 for(const subject of [
  undefined,'','stalin.v.medrano@gmail.com','fake-subject',
  'a.b.c','12345678-1234-1234-1234-123456789abc',
  '12345678-1234-4234-9234-123456789abz',
  null,{subject:SUBJECT},'Bearer token',
 ]){
  assert.throws(()=>build({verifiedAccessSub:subject}),/four-project-enrollment-denied/)
 }
 assert.notDeepEqual(build({verifiedAccessSub:'12345678-1234-4234-9234-123456789abd'}).users[0],
  build().users[0])
})

test('short-lived and invalid expiry always deny rather than make indefinite grants',()=>{
 for(const expiresAt of [NOW-1,NOW,NOW+24*3600000+1,0,NaN,'tomorrow',null]){
  assert.throws(()=>build({expiresAt}),/four-project-enrollment-denied/)
 }
 assert.throws(()=>build({now:NaN}),/four-project-enrollment-denied/)
 assert.doesNotThrow(()=>build({expiresAt:NOW+24*3600000}))
})

test('generated snapshot is accepted by the actual fail-closed reader, and expires/revokes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'friday-four-grants-'))
 t.after(()=>rm(root,{force:true,recursive:true}))
 const dir=join(root,'owner')
 await mkdir(dir,{mode:0o700})
 const path=join(dir,'policy.json')
 let time=NOW
 const reader=createFileWorkSubjectGrants({filePath:path,now:()=>time})
 await writeFile(path,JSON.stringify(build())+'\n',{mode:0o600})
 assert.deepEqual(await reader.grantsForSubject(SUBJECT),{
  allowedProjectIds:Object.values(projectIds),
  allowedMemoryScopes:Object.values(projectIds).map(ownerId=>({scope:'project',ownerId})),
 })
 await assert.rejects(reader.grantsForSubject('12345678-1234-4234-9234-123456789abd'),
  /work-read-denied/)
 time=NOW+3600000
 await assert.rejects(reader.grantsForSubject(SUBJECT),/work-read-denied/)
})
