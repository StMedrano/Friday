import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs'
import {dirname,isAbsolute,resolve} from 'node:path'
import {createOperatorRolePolicy} from './operator-policy.mjs'

const MAX_POLICY_BYTES=16*1024
const MAX_ROLE_WINDOW_MS=24*60*60*1000
const deny=Object.freeze({permits:()=>false})
const ownerOnly=info=>info?.uid===process.getuid()&&(info.mode&0o077)===0
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key))

// INTERNAL-ONLY trusted policy input. There is deliberately no HTTP/admin
// writer or production bootstrap. An operator provisions one canonical JSON
// policy in an owner-private directory through a separately approved workflow.
// Missing, damaged, stale, replaced or insecure policy is denied on every call.
export function createFileOperatorRolePolicy({filePath,now=Date.now}={}) {
 function currentPolicy(){
  if(typeof filePath!=='string'||!isAbsolute(filePath)||typeof now!=='function')return deny
  let fd
  try{
   const directory=dirname(filePath),stat=lstatSync(directory)
   if(!stat.isDirectory()||stat.isSymbolicLink()||!ownerOnly(stat)||
      realpathSync(directory)!==resolve(directory))return deny
   const before=lstatSync(filePath)
   if(!before.isFile()||before.isSymbolicLink()||!ownerOnly(before)||
      before.size<1||before.size>MAX_POLICY_BYTES)return deny
   fd=openSync(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC)
   const meta=fstatSync(fd)
   if(!meta.isFile()||!ownerOnly(meta)||meta.size<1||meta.size>MAX_POLICY_BYTES||
      meta.dev!==before.dev||meta.ino!==before.ino)return deny
   const bytes=readFileSync(fd)
   if(bytes.length<1||bytes.length>MAX_POLICY_BYTES)return deny
   const raw=bytes.toString('utf8')
   const parsed=JSON.parse(raw)
   // The exact canonical representation blocks duplicate keys (including
   // escaped aliases), partial writes, alternate property order, extra lines,
   // and unreviewed free-form configuration without a custom JSON parser.
   // Rebuild with the reviewed field order rather than preserving parsed key
   // insertion order; identical data with reordered or duplicated authority
   // keys is not an accepted provisioning artifact.
   const canonical=JSON.stringify({
    schemaVersion:parsed?.schemaVersion,expiresAt:parsed?.expiresAt,
    bindings:Array.isArray(parsed?.bindings)?parsed.bindings.map(row=>({
     subject:row?.subject,role:row?.role,targets:row?.targets,
    })):parsed?.bindings,
   })+'\n'
   if(raw!==canonical||!exact(parsed,['schemaVersion','expiresAt','bindings'])||
      parsed.schemaVersion!==1)return deny
   const time=now()
   if(!Number.isSafeInteger(time)||time<0||
      !Number.isSafeInteger(parsed.expiresAt)||parsed.expiresAt<=time||
      parsed.expiresAt>time+MAX_ROLE_WINDOW_MS)return deny
   const policy=createOperatorRolePolicy({bindings:parsed.bindings})
   return policy.configured?policy:deny
  }catch{return deny}
  finally{if(fd!==undefined)try{closeSync(fd)}catch{}}
 }
 return Object.freeze({
  permits(identity,permission,target){
   // A caller MUST verify the Access JWT separately. This class never takes
   // identity or grants from model output, HTTP request bodies or headers.
   return currentPolicy().permits(identity,permission,target)
  }
 })
}
