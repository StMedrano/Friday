import {workSubjectHash} from './file-subject-grants.mjs'

export const FOUR_PROJECT_KEYS=Object.freeze([
 'friday-ai-os','techtactics','web-growth-agents','app-builder',
])

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const PROJECT_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_AGE_MS=24*60*60*1000
const fail=()=>{throw Error('four-project-enrollment-denied')}
const exact=(value,fields)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===fields.length&&
 fields.every(key=>Object.hasOwn(value,key))

/**
 * Owner-authorized four-project scope for an existing, independently verified
 * Cloudflare Access user. This is ONLY a deterministic offline policy
 * proposal. It does not authenticate or look up a user, create DB projects,
 * provision a policy file, mount an HTTP route or enable production access.
 *
 * verifiedProjectIds must come from an owner-reviewed authoritative work
 * database mapping, never guessed from group names or display labels.
 */
export function createFourProjectEnrollment({
 verifiedAccessSub,verifiedProjectIds,expiresAt,now=Date.now(),
}={}){
 if(typeof verifiedAccessSub!=='string'||!UUID.test(verifiedAccessSub)||
    !exact(verifiedProjectIds,FOUR_PROJECT_KEYS)||
    !Number.isSafeInteger(now)||now<0||
    !Number.isSafeInteger(expiresAt)||expiresAt<=now||
    expiresAt>now+MAX_AGE_MS)fail()
 const projectIds=[]
 const seen=new Set()
 for(const key of FOUR_PROJECT_KEYS){
  const value=verifiedProjectIds[key]
  if(typeof value!=='string'||!PROJECT_ID.test(value)||
     seen.has(value))fail()
  seen.add(value)
  projectIds.push(value)
 }
 const subjectHash=workSubjectHash(verifiedAccessSub)
 if(!subjectHash)fail()
 return {
  schemaVersion:1,
  expiresAt,
  users:[{
   subjectHash,
   allowedProjectIds:projectIds,
   allowedMemoryScopes:projectIds.map(ownerId=>({scope:'project',ownerId})),
  }],
 }
}
