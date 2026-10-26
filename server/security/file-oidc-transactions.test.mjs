import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,generateKeyPairSync,sign} from 'node:crypto'
import {mkdtemp,readFile,readdir,stat,chmod,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileOidcTransactions} from './file-oidc-transactions.mjs'
import {createPublicOidcFlow} from './public-oidc.mjs'

const TIME=1793034000000
const tx=(state=randomBytes(32).toString('base64url'),applicationId='friday')=>({
 state,applicationId,
 issuer:'https://login.example.test/application/o/'+(applicationId==='friday'?'friday':'future-site')+'/',
 clientId:applicationId==='friday'?'friday-web':'future-web',
 nonce:randomBytes(32).toString('base64url'),
 verifier:randomBytes(32).toString('base64url'),
 issuedAt:TIME,expiresAt:TIME+300000,
})
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'friday-oidc-state-'))
 t.after(()=>rm(dir,{recursive:true,force:true}))
 let now=TIME
 const key=randomBytes(32)
 const make=(extra={})=>createFileOidcTransactions({enabled:true,directory:dir,key,now:()=>now,...extra})
 return {dir,key,make,setTime:x=>{now=x}}
}

test('disabled by default creates no files and never accepts state',async t=>{
 const f=await fixture(t)
 const store=createFileOidcTransactions({directory:f.dir,key:f.key})
 assert.equal(store.enabled,false)
 await assert.rejects(store.reserve(tx()),/sso-denied/)
 await assert.rejects(store.consume(tx().state),/sso-denied/)
 assert.deepEqual(await readdir(f.dir),[])
})

test('private AES-GCM login state survives process reconstruction without exposing code verifier',async t=>{
 const f=await fixture(t)
 const first=f.make(),value=tx()
 await first.reserve(value)
 const entries=await readdir(f.dir)
 assert.equal(entries.length,1)
 assert.equal(entries[0].includes(value.state),false)
 const pending=join(f.dir,entries[0])
 assert.equal((await stat(pending)).mode&0o777,0o600)
 assert.equal((await stat(f.dir)).mode&0o777,0o700)
 const encrypted=await readFile(pending,'utf8')
 for(const secret of [value.state,value.nonce,value.verifier,value.clientId,'friday']){
  assert.equal(encrypted.includes(secret),false)
 }
 const second=f.make()
 assert.deepEqual(await second.consume(value.state),value)
 await assert.rejects(first.consume(value.state),/sso-denied/)
 assert.equal((await readdir(f.dir)).length,2)
})

test('atomically consumes a single state once across independent store instances',async t=>{
 const f=await fixture(t)
 const instances=Array.from({length:8},()=>f.make())
 const value=tx()
 await instances[0].reserve(value)
 const outcomes=await Promise.allSettled(instances.map(store=>store.consume(value.state)))
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1)
 assert.equal(outcomes.filter(x=>x.status==='rejected').length,7)
 assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value,value)
})

test('different registered applications never consume each other state or collide',async t=>{
 const f=await fixture(t)
 const store=f.make(),friday=tx(),future=tx(undefined,'future')
 await store.reserve(friday)
 await store.reserve(future)
 assert.deepEqual(await f.make().consume(future.state),future)
 assert.deepEqual(await f.make().consume(friday.state),friday)
 assert.equal((await readdir(f.dir)).length,4)
})

test('expired login state and clock rollback burn state but never return transaction',async t=>{
 const f=await fixture(t)
 const store=f.make(),value=tx()
 await store.reserve(value)
 f.setTime(TIME+300000)
 await assert.rejects(f.make().consume(value.state),/sso-denied/)
 f.setTime(TIME+1000)
 await assert.rejects(store.consume(value.state),/sso-denied/)
 const later=tx()
 await store.reserve(later)
 f.setTime(TIME-1)
 await assert.rejects(store.consume(later.state),/sso-denied/)
})

test('wrong encryption key and corrupted ciphertext deny permanently, including after restart',async t=>{
 const f=await fixture(t)
 const value=tx()
 await f.make().reserve(value)
 await assert.rejects(f.make({key:randomBytes(32)}).consume(value.state),/sso-denied/)
 await assert.rejects(f.make().consume(value.state),/sso-denied/)
 const next=tx()
 await f.make().reserve(next)
 const file=(await readdir(f.dir)).find(x=>x.endsWith('.pending')&&!x.startsWith('.'))
 // a distinct 2nd transaction remains pending; never modify consumed marker
 assert.equal(typeof file,'string')
 const path=join(f.dir,file)
 await writeFile(path,'{"schemaVersion":1,"bad":true}')
 await assert.rejects(f.make().consume(next.state),/sso-denied/)
})

test('insecure file or directory permission and symlinked path deny before consuming',async t=>{
 const f=await fixture(t)
 const value=tx()
 await f.make().reserve(value)
 const pending=join(f.dir,(await readdir(f.dir))[0])
 await chmod(pending,0o644)
 await assert.rejects(f.make().consume(value.state),/sso-denied/)
 await chmod(pending,0o600)
 await chmod(f.dir,0o755)
 await assert.rejects(f.make().consume(value.state),/sso-denied/)
 await chmod(f.dir,0o700)
 const other=await mkdtemp(join(tmpdir(),'friday-oidc-elsewhere-'))
 t.after(()=>rm(other,{recursive:true,force:true}))
 const alias=join(other,'linked')
 await symlink(f.dir,alias)
 const bad=createFileOidcTransactions({enabled:true,directory:alias,key:f.key,now:()=>TIME})
 await assert.rejects(bad.consume(value.state),/sso-denied/)
 assert.deepEqual(await f.make().consume(value.state),value)
})

test('invalid, replayed or extended transaction records fail closed',async t=>{
 const f=await fixture(t),store=f.make()
 const value=tx()
 for(const invalid of [
  {...value,state:'../escape'}, {...value,nonce:'small'},
  {...value,expiresAt:TIME+3600000},{...value,issuedAt:TIME+5000},
  {...value,token:'not allowed'}, {...value,clientId:'?bad'},
 ]){
  await assert.rejects(store.reserve(invalid),/sso-denied/)
 }
 await store.reserve(value)
 await assert.rejects(store.reserve(value),/sso-denied/)
 await assert.rejects(store.consume('../../etc/passwd'),/sso-denied/)
 assert.deepEqual(await store.consume(value.state),value)
 await assert.rejects(store.reserve(value),/sso-denied/)
})

test('public multi-site OIDC code flow works with durable encrypted transaction store',async t=>{
 const f=await fixture(t)
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
 const issuer='https://login.example.test/application/o/friday/'
 const accessConfig={enabled:true,identityOrigin:'https://login.example.test',applications:[{
  id:'friday',slug:'friday',clientId:'friday-web',
  clientSecret:'synthetic-private-only',redirectUri:'https://friday.example.test/auth/oidc/callback',
 }]}
 const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url')
 let cachedTransaction
 const store=f.make()
 const beginFlow=createPublicOidcFlow(accessConfig,{
  transactions:{...store,reserve:async record=>{cachedTransaction=record;return store.reserve(record)}},
  now:()=>TIME,fetchImpl:async()=>{throw Error('no fetch before callback')},
 })
 const start=await beginFlow.begin({applicationId:'friday'})
 const state=new URL(start.authorizationUrl).searchParams.get('state')
 const fetchImpl=async url=>{
  if(url===issuer+'.well-known/openid-configuration')return {ok:true,json:async()=>({
   issuer,jwks_uri:issuer+'jwks/',authorization_endpoint:'https://login.example.test/application/o/authorize/',
   token_endpoint:'https://login.example.test/application/o/token/',
  })}
  if(url==='https://login.example.test/application/o/token/'){
   const payload={iss:issuer,aud:'friday-web',sub:'public-user',nonce:cachedTransaction.nonce,
    iat:Math.floor(TIME/1000)-30,exp:Math.floor(TIME/1000)+300}
   const signing=b64({alg:'RS256',kid:'fixture',typ:'JWT'})+'.'+b64(payload)
   const id_token=signing+'.'+sign('RSA-SHA256',Buffer.from(signing),privateKey).toString('base64url')
   return {ok:true,json:async()=>({token_type:'Bearer',id_token,access_token:'never-return'})}
  }
  if(url===issuer+'jwks/')return {ok:true,json:async()=>({
   keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'}],
  })}
  throw Error('wrong-target')
 }
 const callbackFlow=createPublicOidcFlow(accessConfig,{
  transactions:f.make(),now:()=>TIME,fetchImpl,
 })
 const user=await callbackFlow.complete({applicationId:'friday',state,code:'one-use-code'})
 assert.equal(user.applicationId,'friday')
 assert.equal(user.identity.kind,'human')
 assert.equal(user.identity.subject.endsWith(':public-user'),true)
 assert.equal(JSON.stringify(user).includes('never-return'),false)
 await assert.rejects(callbackFlow.complete({applicationId:'friday',state,code:'replay'}),/sso-denied/)
})
