import {constants} from 'node:fs'
import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto'
import {link,lstat,open,readFile,realpath,stat} from 'node:fs/promises'
import {isAbsolute,join,resolve} from 'node:path'

const STATE=/^[A-Za-z0-9_-]{43}$/
const NAME=/^[a-z][a-z0-9-]{1,62}$/
const CLIENT=/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/
const ISSUER=/^https:\/\/[a-z0-9.-]+\/application\/o\/[a-z0-9-]+\/$/
const TTL_MS=300000
const MAX_BYTES=2048
const denied=()=>{throw Error('sso-denied')}
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const FIELDS=['state','applicationId','issuer','clientId','nonce','verifier','issuedAt','expiresAt']
const META_FIELDS=['version','iv','tag','data']
const hasState=value=>typeof value==='string'&&STATE.test(value)

function validRecord(tx){
 return exact(tx,FIELDS)&&hasState(tx.state)&&hasState(tx.nonce)&&hasState(tx.verifier)&&
  typeof tx.applicationId==='string'&&NAME.test(tx.applicationId)&&
  typeof tx.clientId==='string'&&CLIENT.test(tx.clientId)&&
  typeof tx.issuer==='string'&&ISSUER.test(tx.issuer)&&
  Number.isSafeInteger(tx.issuedAt)&&tx.issuedAt>=0&&
  Number.isSafeInteger(tx.expiresAt)&&tx.expiresAt-tx.issuedAt===TTL_MS
}
function checkMeta(info,links){
 return info?.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&
  (info.mode&0o077)===0&&info.size>0&&info.size<=MAX_BYTES&&
  info.nlink===links
}

// This is a **single-host POSIX filesystem** interim store, not a distributed
// database. Multiple processes sharing this exact directory have exclusive
// O_EXCL reservation and hard-link based one-winner consumption; unsupported
// network filesystems/multiple hosts must use an independently reviewed
// transactional shared-state backend.
export function createFileOidcTransactions({
 enabled=false,directory,key,now=Date.now,
}={}) {
 const ready=enabled===true&&typeof directory==='string'&&isAbsolute(directory)&&
  resolve(directory)===directory&&Buffer.isBuffer(key)&&key.length===32&&
  typeof now==='function'
 const dirCheck=async()=>{
  if(!ready)denied()
  try{
   const info=await lstat(directory)
   if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||
      (info.mode&0o077)!==0||await realpath(directory)!==directory)denied()
  }catch{denied()}
 }
 const dest=(state,suffix)=>{
  if(!hasState(state))denied()
  // Do not expose raw authorization state in directory names or logs.
  const digest=createHmac('sha256',key).update(state).digest('hex')
  return join(directory,digest+suffix)
 }
 const syncDir=async()=>{
  const fd=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW)
  try{await fd.sync()}finally{await fd.close()}
 }
 return Object.freeze({
  enabled:ready,
  async reserve(tx) {
   if(!ready||!validRecord(tx))denied()
   const at=now()
   // Public OIDC begin() can await the store: accepting a small forward
   // clock advance is required. Never accept future or expired issuance.
   if(!Number.isSafeInteger(at)||at<0||tx.issuedAt>at||
      tx.expiresAt<=at)denied()
   await dirCheck()
   const path=dest(tx.state,'.pending'),used=dest(tx.state,'.used')
   // Never resurrect a previously consumed authorization state.
   try {await lstat(used);denied()}catch(e){if(e.code!=='ENOENT')denied()}
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
   cipher.setAAD(Buffer.from(tx.state,'ascii'))
   const plain=Buffer.from(JSON.stringify(tx),'utf8')
   const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()])
   const raw=JSON.stringify({version:1,iv:iv.toString('base64url'),
    tag:cipher.getAuthTag().toString('base64url'),data:ciphertext.toString('base64url')})+'\n'
   if(Buffer.byteLength(raw)>MAX_BYTES)denied()
   let fd
   try{
    fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
    await fd.writeFile(raw)
    await fd.sync()
    await fd.close()
    fd=undefined
    await syncDir()
   }catch{
    if(fd)await fd.close().catch(()=>{})
    denied()
   }
  },
  async consume(state) {
   if(!ready||!hasState(state))denied()
   await dirCheck()
   const pending=dest(state,'.pending'),claimed=dest(state,'.used')
   // Hard-link of a single immutable file is an atomic, exclusive terminal
   // claim on local POSIX filesystems. No rename-overwrite or check-then-write.
   // On failure, no fallback to stale pending data or second attempt.
   try{
    await link(pending,claimed)
    await syncDir()
    await dirCheck()
    const before=await lstat(claimed)
    if(!checkMeta(before,2))denied()
    const fd=await open(claimed,constants.O_RDONLY|constants.O_NOFOLLOW)
    let raw
    try{
     const current=await fd.stat()
     if(!checkMeta(current,2)||current.dev!==before.dev||current.ino!==before.ino)denied()
     raw=await fd.readFile('utf8')
    }finally{await fd.close()}
    const envelope=JSON.parse(raw)
    if(!exact(envelope,META_FIELDS)||envelope.version!==1||
       typeof envelope.iv!=='string'||typeof envelope.tag!=='string'||
       typeof envelope.data!=='string')denied()
    const iv=Buffer.from(envelope.iv,'base64url')
    const tag=Buffer.from(envelope.tag,'base64url')
    const encrypted=Buffer.from(envelope.data,'base64url')
    if(iv.length!==12||tag.length!==16||encrypted.length<20)denied()
    const decipher=createDecipheriv('aes-256-gcm',key,iv)
    decipher.setAAD(Buffer.from(state,'ascii'))
    decipher.setAuthTag(tag)
    const plain=Buffer.concat([decipher.update(encrypted),decipher.final()])
    const tx=JSON.parse(plain.toString('utf8'))
    const at=now()
    if(!validRecord(tx)||tx.state!==state||!Number.isSafeInteger(at)||
       at<tx.issuedAt||at>=tx.expiresAt)denied()
    await dirCheck()
    return tx
   }catch{denied()}
  },
 })
}
