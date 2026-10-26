import {constants} from 'node:fs'
import {mkdir, lstat, open} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const EVENTS=new Set(['diagnostic-started','diagnostic-completed','diagnostic-failed','restart-requested','restart-approved','denied'])
const FIELDS=['requestId','event','actor','target','at','expiresAt']
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
  },
 })
}
