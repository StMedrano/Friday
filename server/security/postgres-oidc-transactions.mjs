import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto'

const APPS=new Set(['family','techtactics'])
const CONTROL=/^[A-Za-z0-9_-]{43}$/
const CLIENT=/^[A-Za-z0-9][A-Za-z0-9._-]{2,255}$/
const TTL=300000
const MAX_CIPHERTEXT=2048
const deny=()=>{throw Error('sso-denied')}
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))
const timeOk=t=>Number.isSafeInteger(t)&&t>=0
const isControl=value=>typeof value==='string'&&CONTROL.test(value)
const validIssuer=(url,app)=>{
 if(typeof url!=='string'||url.length>256)return false
 try {
  const u=new URL(url)
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&
   u.hostname.includes('.')&&!u.hostname.includes('*')&&
   u.href===url&&u.pathname==='/application/o/'+app+'/'
 }catch{return false}
}
const FIELDS=['state','applicationId','issuer','clientId','nonce','verifier','issuedAt','expiresAt']
const validTransaction=(tx,app)=>exact(tx,FIELDS)&&
 tx.applicationId===app&&isControl(tx.state)&&isControl(tx.nonce)&&isControl(tx.verifier)&&
 typeof tx.clientId==='string'&&CLIENT.test(tx.clientId)&&
 validIssuer(tx.issuer,app)&&timeOk(tx.issuedAt)&&timeOk(tx.expiresAt)&&
 tx.expiresAt-tx.issuedAt===TTL
const INSERT=`INSERT INTO friday_identity.oidc_transactions
 (application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms)
 VALUES ($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT DO NOTHING RETURNING 1 AS ok`
const CONSUME=`DELETE FROM friday_identity.oidc_transactions
 WHERE application_id=$1 AND state_hash=$2 AND expires_at_ms>$3
 RETURNING application_id,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms`
const CLEANUP=`WITH expired AS (
 SELECT application_id,state_hash
 FROM friday_identity.oidc_transactions
 WHERE application_id=$1 AND expires_at_ms<=$2
 ORDER BY expires_at_ms LIMIT $3 FOR UPDATE SKIP LOCKED
)
DELETE FROM friday_identity.oidc_transactions AS t USING expired
 WHERE t.application_id=expired.application_id AND t.state_hash=expired.state_hash
 RETURNING 1 AS ok`
function checkedReply(reply){
 if(!reply||!Number.isSafeInteger(reply.rowCount)||reply.rowCount<0||
    !Array.isArray(reply.rows)||reply.rows.length!==reply.rowCount)deny()
 return reply
}
function canonicalB64(value,sizeMax){
 if(typeof value!=='string'||value.length<1||value.length>sizeMax||
    !/^[A-Za-z0-9_-]+$/.test(value))deny()
 const buf=Buffer.from(value,'base64url')
 if(buf.toString('base64url')!==value)deny()
 return buf
}

/**
 * Private source-only, default-disabled OIDC state store. Atomic
 * PostgreSQL INSERT and DELETE RETURNING make single-use transactions
 * safe across site-local replicas sharing the same database. The site
 * operator supplies a *separate* PostgreSQL login role per site and a
 * private 32-byte key, never client-side.
 *
 * AES-GCM protects state, nonce, PKCE verifier, issuer and client ID at
 * rest; keyed SHA-256 hides raw OAuth state in indexes and query logs.
 * No routes, DB connections, login keys or production bootstrap included.
 */
export function createPostgresOidcTransactions({
 enabled=false,applicationId,key,query,now=Date.now,
}={}) {
 const ready=enabled===true&&APPS.has(applicationId)&&Buffer.isBuffer(key)&&
  key.length===32&&typeof query==='function'&&typeof now==='function'
 // Independent cryptographic domains for database identifiers and AEAD.
 const nameKey=ready?createHmac('sha256',key).update('friday-oidc-index-v1').digest():null
 const cipherKey=ready?createHmac('sha256',key).update('friday-oidc-cipher-v1').digest():null
 const at=()=>{
  const value=now()
  if(!timeOk(value))deny()
  return value
 }
 const hash=state=>createHmac('sha256',nameKey)
  .update(applicationId+':'+state).digest('hex')
 const sql=async(queryText,params)=>{
  if(!ready)deny()
  try{return checkedReply(await query(queryText,params))}
  catch{deny()}
 }
 return Object.freeze({
  enabled:ready,
  async reserve(tx){
   if(!ready||!validTransaction(tx,applicationId))deny()
   const current=at()
   if(tx.issuedAt>current||tx.expiresAt<=current)deny()
   const digest=hash(tx.state),iv=randomBytes(12)
   const cipher=createCipheriv('aes-256-gcm',cipherKey,iv)
   cipher.setAAD(Buffer.from(applicationId+':'+digest))
   const plaintext=Buffer.from(JSON.stringify(tx))
   const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()])
   if(encrypted.length>MAX_CIPHERTEXT)deny()
   const result=await sql(INSERT,[applicationId,digest,
    iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),tx.issuedAt,tx.expiresAt])
   if(result.rowCount!==1)deny()
  },
  async consume(state){
   if(!ready||!isControl(state))deny()
   const current=at(),digest=hash(state)
   // One DELETE RETURNING is the replay barrier. A malformed result or
   // wrong decrypt key permanently spends the matched state.
   const result=await sql(CONSUME,[applicationId,digest,current])
   if(result.rowCount!==1)deny()
   const row=result.rows[0]
   const issuedAt=Number(row?.issued_at_ms)
   const expiresAt=Number(row?.expires_at_ms)
   if(row?.application_id!==applicationId||row.state_hash!==digest||
      !timeOk(issuedAt)||!timeOk(expiresAt)||issuedAt>current||
      expiresAt<=current||expiresAt-issuedAt!==TTL)deny()
   try {
    const iv=canonicalB64(row.iv,32)
    const tag=canonicalB64(row.tag,32)
    const ciphertext=canonicalB64(row.ciphertext,4096)
    if(iv.length!==12||tag.length!==16||ciphertext.length<32||
       ciphertext.length>MAX_CIPHERTEXT)deny()
    const cipher=createDecipheriv('aes-256-gcm',cipherKey,iv)
    cipher.setAAD(Buffer.from(applicationId+':'+digest))
    cipher.setAuthTag(tag)
    const data=Buffer.concat([cipher.update(ciphertext),cipher.final()])
    const tx=JSON.parse(data.toString('utf8'))
    if(!validTransaction(tx,applicationId)||tx.state!==state||
       tx.issuedAt!==issuedAt||tx.expiresAt!==expiresAt)deny()
    return tx
   }catch{deny()}
  },
  // Only trusted internal lifecycle scheduler may call this; never mount
  // cleanup on public HTTP/API or AI model tool routes.
  async cleanup(input={}){
   if(!ready||!exact(input,['limit'])&&
      !(input&&typeof input==='object'&&!Array.isArray(input)&&
        Object.keys(input).length===0))deny()
   const limit=input.limit??100
   if(!Number.isSafeInteger(limit)||limit<1||limit>1000)deny()
   const result=await sql(CLEANUP,[applicationId,at(),limit])
   if(result.rowCount>limit)deny()
   return result.rowCount
  },
 })
}
