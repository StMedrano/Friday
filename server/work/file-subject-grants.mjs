import {createHash} from 'node:crypto'
import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs'
import {dirname,isAbsolute,resolve} from 'node:path'
import {createPrivateWorkReadBridge} from './private-read-bridge.mjs'

const MAX_BYTES=16*1024
const MAX_VALIDITY_MS=24*60*60*1000
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/
const IDENTIFIER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const HASH=/^[a-f0-9]{64}$/
const SCOPES=new Set(['project','task'])
const fail=()=>{throw Error('work-read-denied')}
const record=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key))
const ownerOnly=info=>info?.uid===process.getuid()&&(info.mode&0o077)===0
const id=value=>typeof value==='string'&&IDENTIFIER.test(value)

/** Exact subject from a verified Friday Cloudflare Access JWT, NEVER email. */
export function workSubjectHash(subject) {
 if(typeof subject!=='string'||!SUBJECT.test(subject))return null
 return createHash('sha256')
  .update('friday-work:cloudflare-access:subject:v1\0')
  .update(subject,'utf8').digest('hex')
}

function validate(snapshot,time){
 if(!record(snapshot,['schemaVersion','expiresAt','users'])||
    snapshot.schemaVersion!==1||!Number.isSafeInteger(snapshot.expiresAt)||
    !Number.isSafeInteger(time)||time<0||
    snapshot.expiresAt<=time||snapshot.expiresAt>time+MAX_VALIDITY_MS||
    !Array.isArray(snapshot.users)||snapshot.users.length>64)return false
 const seen=new Set()
 for(const user of snapshot.users){
  if(!record(user,['subjectHash','allowedProjectIds','allowedMemoryScopes'])||
     typeof user.subjectHash!=='string'||!HASH.test(user.subjectHash)||
     seen.has(user.subjectHash)||
     !Array.isArray(user.allowedProjectIds)||user.allowedProjectIds.length<1||
     user.allowedProjectIds.length>25||
     !Array.isArray(user.allowedMemoryScopes)||user.allowedMemoryScopes.length>25)
   return false
  seen.add(user.subjectHash)
  const projects=new Set()
  for(const projectId of user.allowedProjectIds){
   if(!id(projectId)||projects.has(projectId))return false
   projects.add(projectId)
  }
  const scopes=new Set()
  for(const scope of user.allowedMemoryScopes){
   if(!record(scope,['scope','ownerId'])||!SCOPES.has(scope.scope)||
      !id(scope.ownerId))return false
   const key=scope.scope+':'+scope.ownerId
   if(scopes.has(key)||
      (scope.scope==='project'&&!projects.has(scope.ownerId)))return false
   scopes.add(key)
  }
 }
 return true
}

// Reconstruction in fixed key order rejects duplicate or escaped duplicate
// JSON authority keys, unknown fields, trailing bytes, and noncanonical
// provisioning. Use a separately reviewed atomic rename when editing policy.
function canonicalPolicy(snapshot) {
 return JSON.stringify({
  schemaVersion:snapshot?.schemaVersion,
  expiresAt:snapshot?.expiresAt,
  users:Array.isArray(snapshot?.users)?snapshot.users.map(user=>({
   subjectHash:user?.subjectHash,
   allowedProjectIds:user?.allowedProjectIds,
   allowedMemoryScopes:Array.isArray(user?.allowedMemoryScopes)?
     user.allowedMemoryScopes.map(scope=>({
      scope:scope?.scope,ownerId:scope?.ownerId,
     })):user?.allowedMemoryScopes,
  })):snapshot?.users,
 })+'\n'
}

/**
 * Owner-owned private file at an operator-selected absolute path, NOT under
 * Git. No file creation, network requests, identity lookup or policy writes.
 * Each call reopens the file so removal/expiry/downgrades take effect on the
 * next request. A signed human Cloudflare JWT MUST be verified independently
 * by createPrivateWorkReadBridge before this lookup is called.
 */
export function createFileWorkSubjectGrants({filePath,now=Date.now}={}){
 const configured=typeof filePath==='string'&&isAbsolute(filePath)&&
  typeof now==='function'&&resolve(filePath)===filePath
 async function grantsForSubject(subject){
  const digest=workSubjectHash(subject)
  if(!configured||!digest)fail()
  let fd
  try{
   const dir=dirname(filePath),directory=lstatSync(dir)
   if(!directory.isDirectory()||directory.isSymbolicLink()||
      !ownerOnly(directory)||realpathSync(dir)!==resolve(dir))fail()
   const before=lstatSync(filePath)
   if(!before.isFile()||before.isSymbolicLink()||!ownerOnly(before)||
      before.nlink!==1||before.size<1||before.size>MAX_BYTES)fail()
   fd=openSync(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC|
     constants.O_NONBLOCK)
   const info=fstatSync(fd)
   if(!info.isFile()||!ownerOnly(info)||info.nlink!==1||info.size<1||
      info.size>MAX_BYTES||info.ino!==before.ino||info.dev!==before.dev)fail()
   const bytes=readFileSync(fd)
   if(bytes.length<1||bytes.length>MAX_BYTES||bytes.length!==info.size)fail()
   const raw=bytes.toString('utf8')
   const parsed=JSON.parse(raw)
   if(raw!==canonicalPolicy(parsed)||!validate(parsed,now()))fail()
   const user=parsed.users.find(row=>row.subjectHash===digest)
   if(!user)fail()
   return {
    allowedProjectIds:[...user.allowedProjectIds],
    allowedMemoryScopes:user.allowedMemoryScopes.map(s=>({scope:s.scope,ownerId:s.ownerId})),
   }
  }catch{fail()}
  finally{if(fd!==undefined)try{closeSync(fd)}catch{}}
 }
 return Object.freeze({enabled:configured,grantsForSubject})
}

/**
 * Explicit opt-in composition of the verified-human Phase 2B read bridge with
 * owner-managed, revocable per-user grants. Does not mount a public HTTP route,
 * grant AI tools, or establish any real authenticated user by itself.
 */
export function createTrustedWorkReadBridge({
 enabled=false,grantFilePath,now=Date.now,access,workService,memoryService,fetchKeys,
}={}){
 const source=createFileWorkSubjectGrants({filePath:grantFilePath,now})
 return createPrivateWorkReadBridge({
  enabled:enabled===true&&source.enabled,access,workService,memoryService,fetchKeys,
  grantsForSubject:source.grantsForSubject,
 })
}
