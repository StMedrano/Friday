import {constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, resolve} from 'node:path'

const MAX_BYTES=512
const MAX_ARM_WINDOW_MS=5*60*1000
const KEYS=['schemaVersion','state','expiresAt']

const ownerOnly=info=>info?.uid===process.getuid() && (info.mode&0o077)===0
const exact=(row)=>row!==null && typeof row==='object' && !Array.isArray(row) &&
 Object.keys(row).length===KEYS.length && KEYS.every(k=>Object.hasOwn(row,k))

// No UI/HTTP mutation route: this is an internal dependency for future action
// guards. Missing, corrupt, stale or insecure files ALWAYS deny. Unlike an
// environment flag, the owner can revoke approval between any two checks.
export function createFileAutomationGate({filePath,now=Date.now}={}) {
 const isAllowed=()=>{
  if(typeof filePath!=='string'||!isAbsolute(filePath)||typeof now!=='function')return false
  const parent=dirname(filePath)
  let fd
  try {
   const directory=lstatSync(parent)
   if(!directory.isDirectory()||directory.isSymbolicLink()||!ownerOnly(directory))return false
   // Reject symlinked ancestors too; do not follow a redirected gate directory.
   if(realpathSync(parent)!==resolve(parent))return false
   const before=lstatSync(filePath)
   if(!before.isFile()||before.isSymbolicLink()||!ownerOnly(before)||
     before.size<1||before.size>MAX_BYTES)return false
   fd=openSync(filePath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC)
   const info=fstatSync(fd)
   if(!info.isFile()||!ownerOnly(info)||info.size<1||info.size>MAX_BYTES||
     info.ino!==before.ino||info.dev!==before.dev)return false
   const body=readFileSync(fd,'utf8')
   if(Buffer.byteLength(body)>MAX_BYTES)return false
   const state=JSON.parse(body)
   const at=now()
   return exact(state) && state.schemaVersion===1 &&
     state.state==='allow-approved-actions' &&
     Number.isSafeInteger(state.expiresAt) && Number.isSafeInteger(at) &&
     state.expiresAt>at && state.expiresAt<=at+MAX_ARM_WINDOW_MS
  } catch {return false}
  finally {if(fd!==undefined)try{closeSync(fd)}catch{}}
 }
 return Object.freeze({isAllowed})
}
