const ALLOWED_SITES=new Set(['family','techtactics'])
const HASH=/^[A-Za-z0-9_-]{43}$/
const SUBJECT=/^authentik:[a-f0-9]{16}:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/
const MAX_MS=3600000
const deny=()=>{throw Error('sso-denied')}
const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===keys.length&&keys.every(key=>Object.hasOwn(obj,key))
const safeTime=value=>Number.isSafeInteger(value)&&value>=0
const validApp=value=>typeof value==='string'&&ALLOWED_SITES.has(value)
const validHash=value=>typeof value==='string'&&HASH.test(value)
const validSubject=value=>typeof value==='string'&&SUBJECT.test(value)
const validRead=input=>exact(input,['applicationId','tokenHash'])&&
 validApp(input.applicationId)&&validHash(input.tokenHash)
const validNew=input=>exact(input,['applicationId','tokenHash','subject','createdAt','expiresAt'])&&
 validApp(input.applicationId)&&validHash(input.tokenHash)&&validSubject(input.subject)&&
 safeTime(input.createdAt)&&safeTime(input.expiresAt)&&
 input.expiresAt>input.createdAt&&input.expiresAt-input.createdAt<=MAX_MS

const INSERT=`INSERT INTO friday_identity.web_sessions
 (application_id,token_hash,subject,created_at_ms,expires_at_ms)
 VALUES ($1,$2,$3,$4,$5)
 ON CONFLICT DO NOTHING RETURNING 1 AS ok`
const SELECT=`SELECT application_id,token_hash,subject,created_at_ms,expires_at_ms
 FROM friday_identity.web_sessions
 WHERE application_id=$1 AND token_hash=$2 AND expires_at_ms>$3`
const REVOKE=`DELETE FROM friday_identity.web_sessions
 WHERE application_id=$1 AND token_hash=$2 AND expires_at_ms>$3
 RETURNING 1 AS ok`
const REVOKE_SUBJECT=`DELETE FROM friday_identity.web_sessions
 WHERE application_id=$1 AND subject=$2 RETURNING 1 AS ok`
const CLEANUP=`WITH expired AS (
 SELECT application_id,token_hash FROM friday_identity.web_sessions
 WHERE application_id=$1 AND expires_at_ms<=$2
 ORDER BY expires_at_ms LIMIT $3
 FOR UPDATE SKIP LOCKED
)
DELETE FROM friday_identity.web_sessions AS sessions USING expired
WHERE sessions.application_id=expired.application_id
 AND sessions.token_hash=expired.token_hash RETURNING 1 AS ok`

const ensureRows=result=>{
 if(!result||!Number.isSafeInteger(result.rowCount)||result.rowCount<0||
    !Array.isArray(result.rows)||result.rows.length!==result.rowCount)deny()
 return result
}

/**
 * Default-disabled, source-only store for *normal website* Authentik sessions.
 * Uses an injected server-only PostgreSQL client's parameterized query().
 *
 * Requires a separately provisioned dedicated least-privilege PG login role
 * belonging to friday_sso_server, with access ONLY to private schema rows.
 * No JS client secret, OAuth token, raw opaque cookie, session role,
 * HomeLab approval or infrastructure write tool is stored or returned.
 *
 * All calls are atomic individual SQL statements, safe across independent
 * app processes sharing one transactional Postgres database. They are NOT
 * currently wired to the Friday production HTTP/server bootstrap.
 */
export function createPostgresLoginSessions({enabled=false,applicationId,query,now=Date.now}={}) {
 // Every backend is permanently bound to ONE website and must use that
 // website's distinct DB login role. Never infer it from browser requests.
 const configuredApplicationId=applicationId
 const ready=enabled===true&&validApp(configuredApplicationId)&&
  typeof query==='function'&&typeof now==='function'
 const clock=()=>{
  const value=now()
  if(!safeTime(value))deny()
  return value
 }
 const run=async(text,params)=>{
  if(!ready)deny()
  try{return ensureRows(await query(text,params))}
  catch{deny()}
 }
 return Object.freeze({
  enabled:ready,
  async create(record){
   if(!ready||!validNew(record)||record.applicationId!==applicationId)deny()
   const at=clock()
   if(record.createdAt>at||record.expiresAt<=at)deny()
   const result=await run(INSERT,[
    record.applicationId,record.tokenHash,record.subject,record.createdAt,record.expiresAt,
   ])
   // A collision MUST NOT authenticate a browser without a fresh unique row.
   if(result.rowCount!==1)deny()
  },
  async read(input){
   if(!ready||!validRead(input)||input.applicationId!==applicationId)deny()
   const at=clock()
   const result=await run(SELECT,[input.applicationId,input.tokenHash,at])
   if(result.rowCount===0)return null
   if(result.rowCount!==1)deny()
   const row=result.rows[0]
   const value={
    applicationId:row?.application_id,
    tokenHash:row?.token_hash,
    subject:row?.subject,
    createdAt:Number(row?.created_at_ms),
    expiresAt:Number(row?.expires_at_ms),
   }
   if(!validNew(value)||value.applicationId!==input.applicationId||
      value.tokenHash!==input.tokenHash||value.createdAt>at||value.expiresAt<=at)deny()
   return value
  },
  async revoke(input){
   if(!ready||!validRead(input)||input.applicationId!==applicationId)deny()
   const at=clock()
   const result=await run(REVOKE,[input.applicationId,input.tokenHash,at])
   if(result.rowCount>1)deny()
   return result.rowCount===1
  },
  // Trusted internal account-offboarding only; NEVER expose this to a
  // public login, model tool or role inferred from OAuth browser headers.
  async revokeSubject(input){
   if(!ready||!exact(input,['applicationId','subject'])||
      !validApp(input.applicationId)||input.applicationId!==applicationId||
      !validSubject(input.subject))deny()
   const result=await run(REVOKE_SUBJECT,[input.applicationId,input.subject])
   return result.rowCount
  },
  // Optional application-scoped bounded cleanup. A scheduler and retention
  // policy remain a separate deployment task; no cron is created here.
  async cleanup({applicationId,limit=100}={}){
   if(!ready||!validApp(applicationId)||applicationId!==configuredApplicationId||
      !Number.isSafeInteger(limit)||
      limit<1||limit>1000)deny()
   const result=await run(CLEANUP,[applicationId,clock(),limit])
   if(result.rowCount>limit)deny()
   return result.rowCount
  },
 })
}
