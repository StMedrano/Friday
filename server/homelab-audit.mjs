import {constants} from 'node:fs'
import {mkdir, lstat, open, opendir} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const EVENTS=new Set(['diagnostic-started','diagnostic-completed','diagnostic-failed','restart-requested','restart-decided','denied'])
const FIELDS=['requestId','event','actor','target','at','expiresAt']
const OUTCOMES=new Set(['approved','rejected','withdrawn'])
const MAX_QUEUE_FILES=512
const AUDIT_FILE=/^([a-f0-9-]{36})\.([a-z-]+)\.json$/
const denied=()=>{throw Error('homelab-denied')}
export function validRequestId(value){return typeof value==='string'&&UUID.test(value)}
function valid(record) {
 const decision=record?.event==='restart-decided'
 return record&&typeof record==='object'&&!Array.isArray(record)&&
  Object.keys(record).length===FIELDS.length+(decision?1:0)&&
  FIELDS.every(key=>Object.hasOwn(record,key))&&
  (!decision||Object.hasOwn(record,'outcome')&&OUTCOMES.has(record.outcome))&&
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
 const validProposal=row=>row&&row.event==='restart-requested'&&row.target==='staging-canary'&&
  row.expiresAt>row.at&&row.expiresAt-row.at<=300000
 const validDecision=(decision,proposal)=>decision&&decision.event==='restart-decided'&&
  decision.requestId===proposal.requestId&&decision.target===proposal.target&&
  decision.expiresAt===proposal.expiresAt&&decision.at>=proposal.at&&
  decision.at<=proposal.expiresAt&&
  (decision.outcome==='withdrawn'?decision.actor===proposal.actor:
    decision.actor!==proposal.actor)
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
  // Bounded single-request state projection. No public endpoint or action is
  // added here. Read a request and its *one* exclusive terminal decision;
  // a concurrent decision can change this snapshot immediately afterward.
  async readLifecycle({requestId,at}={}) {
   if(!validRequestId(requestId)||!Number.isSafeInteger(at)||at<0)denied()
   try {
    const proposal=await readRecord(requestId,'restart-requested')
    const decision=await readRecord(requestId,'restart-decided')
    if(!validProposal(proposal)||proposal.at>at||
       (decision&&!validDecision(decision,proposal)))denied()
    await checkDirectory()
    const state=decision?
      {approved:'approved-execution-unavailable',rejected:'rejected',
       withdrawn:'withdrawn'}[decision.outcome]:
      at>=proposal.expiresAt?'expired':'pending-approval'
    return {requestId,target:proposal.target,at:proposal.at,
      expiresAt:proposal.expiresAt,actor:proposal.actor,
      decidedAt:decision?.at??null,decidedBy:decision?.actor??null,state}
   } catch {denied()}
  },
  // Internal, bounded, read-only approval projection. No HTTP method exposes it.
  // A concurrent terminal decision can make this snapshot stale. Each
  // approve/reject/withdraw action validates the proposal and exclusively
  // appends the SAME immutable decision event filename.
  async listPending({at,limit=20}={}) {
   if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(limit)||limit<1||limit>50)denied()
   await checkDirectory()
   const proposed=new Set(),decided=new Set()
   let scanned=0
   try {
    const cursor=await opendir(directory)
    for await(const entry of cursor) {
     if(++scanned>MAX_QUEUE_FILES)denied()
     const match=AUDIT_FILE.exec(entry.name)
     if(!match||!validRequestId(match[1])||!EVENTS.has(match[2])||!entry.isFile())denied()
     if(match[2]==='restart-requested')proposed.add(match[1])
     if(match[2]==='restart-decided')decided.add(match[1])
    }
    for(const id of decided)if(!proposed.has(id))denied()
    const items=[]
    for(const id of proposed) {
     const row=await readRecord(id,'restart-requested')
     if(!row)denied() // Never emit partial results during concurrent deletion.
     // Proposals in the dormant fixture may live for at most five minutes.
     // Corrupt or forged long-lived requests invalidate the entire snapshot.
     if(!validProposal(row))denied()
     if(decided.has(id)) {
      const action=await readRecord(id,'restart-decided')
      if(!validDecision(action,row))denied()
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
