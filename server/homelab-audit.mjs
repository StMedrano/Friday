import {constants} from 'node:fs'
import {mkdir, lstat, open, opendir} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const EVENTS=new Set(['diagnostic-started','diagnostic-completed','diagnostic-failed','restart-requested','restart-approved','denied'])
const FIELDS=['requestId','event','actor','target','at','expiresAt']
const MAX_QUEUE_FILES=512
const AUDIT_FILE=/^([a-f0-9-]{36})\.([a-z-]+)\.json$/
const denied=()=>{throw Error('homelab-denied')}
export function validRequestId(value){return typeof value==='string'&&UUID.test(value)}
function valid(record) {
 return record&&Object.keys(record).length===FIELDS.length&&FIELDS.every(key=>Object.hasOwn(record,key))&&
  validRequestId(record.requestId)&&EVENTS.has(record.event)&&/^[a-f0-9]{64}$/.test(record.actor)&&
  record.target==='staging-canary'&&Number.isSafeInteger(record.at)&&record.at>=0&&
  Number.isSafeInteger(record.expiresAt)&&record.expiresAt>=record.at
}

// A trusted private local directory, never an infrastructure path. Each event is
// create-only, fsynced before return. No update/delete/repair API is exposed.
export async function createHomeLabAudit({directory}={}) {
 if(typeof directory!=='string'||!isAbsolute(directory))denied()
 await mkdir(directory,{recursive:true,mode:0o700})
 const checkDirectory=async()=>{
  const info=await lstat(directory)
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||info.uid!==process.getuid())denied()
 }
 await checkDirectory()
 const path=(requestId,event)=>{
  if(!validRequestId(requestId)||!EVENTS.has(event))denied()
  return join(directory,requestId+'.'+event+'.json')
 }
 // Shared read path: never accept untrusted filenames or follow symlinked files.
 async function readRecord(requestId,event) {
  await checkDirectory()
  let file
  try {file=await open(path(requestId,event),constants.O_RDONLY|constants.O_NOFOLLOW)}
  catch(error){if(error.code==='ENOENT')return null;throw error}
  try {
   const info=await file.stat()
   if(!info.isFile()||info.size>2048||(info.mode&0o077)!==0||info.uid!==process.getuid())denied()
   const record=JSON.parse(await file.readFile('utf8'))
   if(!valid(record)||record.requestId!==requestId||record.event!==event)denied()
   return record
  } finally {await file.close()}
 }
 return Object.freeze({
  async append(record) {
   if(!valid(record))denied()
   await checkDirectory()
   const file=await open(path(record.requestId,record.event),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
   try {await file.writeFile(JSON.stringify(record)+'\n');await file.sync()} finally {await file.close()}
   const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
   try {await dir.sync()} finally {await dir.close()}
  },
  async read(requestId,event) {
   return readRecord(requestId,event)
  },
  // Internal, bounded, read-only approval projection. No HTTP method exposes it.
  // A concurrent approval can make this snapshot stale; approveRestart always
  // re-reads the request and atomically appends the single-use approval.
  async listPending({at,limit=20}={}) {
   if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(limit)||limit<1||limit>50)denied()
   await checkDirectory()
   const proposed=new Set(),approved=new Set()
   let scanned=0
   try {
    const cursor=await opendir(directory)
    for await(const entry of cursor) {
     if(++scanned>MAX_QUEUE_FILES)denied()
     const match=AUDIT_FILE.exec(entry.name)
     if(!match||!validRequestId(match[1])||!EVENTS.has(match[2])||!entry.isFile())denied()
     if(match[2]==='restart-requested')proposed.add(match[1])
     if(match[2]==='restart-approved')approved.add(match[1])
    }
    for(const id of approved)if(!proposed.has(id))denied()
    const items=[]
    for(const id of proposed) {
     const row=await readRecord(id,'restart-requested')
     if(!row)denied() // Never emit partial results during concurrent deletion.
     // Proposals in the dormant fixture may live for at most five minutes.
     // Corrupt or forged long-lived requests invalidate the entire snapshot.
     if(row.expiresAt<=row.at||row.expiresAt-row.at>300000)denied()
     if(approved.has(id)) {
      const action=await readRecord(id,'restart-approved')
      if(!action||action.target!==row.target||action.at<row.at||action.at>row.expiresAt||
         action.actor===row.actor)denied()
      continue
     }
     if(row.expiresAt<=at||row.at>at)continue
     items.push({requestId:row.requestId,target:row.target,at:row.at,
       expiresAt:row.expiresAt,actor:row.actor})
    }
    await checkDirectory()
    return items.sort((a,b)=>a.expiresAt-b.expiresAt||
      a.requestId.localeCompare(b.requestId)).slice(0,limit)
   } catch {denied()}
  },
 })
}
