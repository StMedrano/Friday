import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,request as httpRequest} from 'node:http'
import {once} from 'node:events'
import {generateKeyPairSync,sign} from 'node:crypto'
import {createPublicLoginRuntime} from './public-login-runtime.mjs'

const NOW=1793090000000
const IDS=['family','techtactics']
const appOrigin=id=>id==='family'?'https://family.example.test':'https://accounts.example.test'
const identityOrigin=id=>'https://id-'+id+'.example.test'
const config=(queries)=>IDS.map((id,i)=>({
 id,publicOrigin:appOrigin(id),identityOrigin:identityOrigin(id),
 clientId:id+'-web',clientSecret:'fixture-private-'+id,
 signingKey:Buffer.alloc(32,i+1),transactionKey:Buffer.alloc(32,i+3),
 query:queries[i],
}))

function database(){
 const stores=IDS.map(()=>({transactions:new Map(),sessions:new Map(),calls:[]}))
 const queries=stores.map(store=>async(sql,params)=>{
  store.calls.push({sql,params})
  if(sql.startsWith('INSERT INTO friday_identity.oidc_transactions')){
   const [app,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms]=params
   const id=app+':'+state_hash
   if(store.transactions.has(id))return {rowCount:0,rows:[]}
   store.transactions.set(id,{application_id:app,state_hash,iv,tag,ciphertext,issued_at_ms,expires_at_ms})
   return {rowCount:1,rows:[{ok:1}]}
  }
  if(sql.startsWith('DELETE FROM friday_identity.oidc_transactions')){
   const [app,digest,now]=params,id=app+':'+digest
   const row=store.transactions.get(id)
   if(!row||row.expires_at_ms<=now)return {rowCount:0,rows:[]}
   store.transactions.delete(id)
   return {rowCount:1,rows:[row]}
  }
  if(sql.startsWith('INSERT INTO friday_identity.web_sessions')){
   const [app,token_hash,subject,created_at_ms,expires_at_ms]=params
   const id=app+':'+token_hash
   if(store.sessions.has(id))return {rowCount:0,rows:[]}
   store.sessions.set(id,{application_id:app,token_hash,subject,created_at_ms,expires_at_ms})
   return {rowCount:1,rows:[{ok:1}]}
  }
  if(sql.startsWith('SELECT application_id,token_hash,subject')){
   const [app,digest,now]=params
   const row=store.sessions.get(app+':'+digest)
   return row&&row.expires_at_ms>now?{rowCount:1,rows:[row]}:{rowCount:0,rows:[]}
  }
  if(sql.startsWith('DELETE FROM friday_identity.web_sessions')){
   const [app,digest,now]=params,id=app+':'+digest
   const row=store.sessions.get(id)
   if(!row||row.expires_at_ms<=now)return {rowCount:0,rows:[]}
   store.sessions.delete(id)
   return {rowCount:1,rows:[{ok:1}]}
  }
  throw Error('Unexpected SQL in fixture')
 })
 return {stores,queries}
}
async function serve(t,handler){
 const server=createServer(handler)
 server.listen(0,'127.0.0.1')
 await once(server,'listening')
 t.after(async()=>{server.close();await once(server,'close')})
 return server.address().port
}
async function call(port,site,{method='GET',path='/login',headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port,method,path,headers:{
   host:new URL(appOrigin(site)).host,connection:'close',
   ...(body===undefined?{}:{'content-length':Buffer.byteLength(body)}),...headers,
  }},async res=>{
   const parts=[]
   for await(const part of res)parts.push(part)
   resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts).toString('utf8')})
  })
  req.on('error',reject)
  if(body!==undefined)req.write(body)
  req.end()
 })
}
const make=({enabled=true,sites,fetchImpl=async()=>{throw Error('unexpected external fetch')}})=>
 createPublicLoginRuntime({enabled,sites,fetchImpl,now:()=>NOW})

test('closed by default: missing/invalid settings cannot produce either public handler',()=>{
 const db=database(),sites=config(db.queries)
 for(const input of [
  {sites},{enabled:true,sites:[sites[0]]},
  {enabled:true,sites:[sites[0],{...sites[1],id:'family'}]},
  {enabled:true,sites:[sites[0],{...sites[1],publicOrigin:sites[0].publicOrigin}]},
  {enabled:true,sites:[sites[0],{...sites[1],identityOrigin:sites[0].identityOrigin}]},
  {enabled:true,sites:[sites[0],{...sites[1],clientId:sites[0].clientId}]},
  {enabled:true,sites:[sites[0],{...sites[1],query:sites[0].query}]},
  {enabled:true,sites:[sites[0],{...sites[1],signingKey:sites[0].signingKey}]},
  {enabled:true,sites:[sites[0],{...sites[1],transactionKey:sites[0].transactionKey}]},
  {enabled:true,sites:[sites[0],{...sites[1],transactionKey:Buffer.alloc(5)}]},
  {enabled:true,sites:[{...sites[0],signingKey:sites[0].transactionKey},sites[1]]},
  {enabled:true,sites:[{...sites[0],extra:'privileged'},sites[1]]},
 ]){
  const runtime=createPublicLoginRuntime(input)
  assert.equal(runtime.enabled,false)
  assert.equal(runtime.handlerFor('family'),null)
  assert.equal(runtime.handlerFor('techtactics'),null)
 }
 assert.equal(db.stores.every(store=>store.calls.length===0),true)
})

test('two isolated HTTPS website handlers compose one-use encrypted OIDC with durable per-site sessions',async t=>{
 const db=database()
 const keys=IDS.map(()=>generateKeyPairSync('rsa',{modulusLength:2048}))
 const nonceBySite=new Map()
 const fetchImpl=async url=>{
  const site=IDS.find(id=>url.startsWith(identityOrigin(id)+'/'))
  if(!site)throw Error('unregistered origin')
  const issuer=identityOrigin(site)+'/application/o/'+site+'/'
  const index=IDS.indexOf(site)
  const jwk={...keys[index].publicKey.export({format:'jwk'}),kid:'fixture-'+site,alg:'RS256',use:'sig'}
  if(url===issuer+'.well-known/openid-configuration')
   return {ok:true,json:async()=>({
    issuer,jwks_uri:issuer+'jwks/',
    authorization_endpoint:identityOrigin(site)+'/application/o/authorize/',
    token_endpoint:identityOrigin(site)+'/application/o/token/',
   })}
  if(url===issuer+'jwks/')return {ok:true,json:async()=>({keys:[jwk]})}
  if(url===identityOrigin(site)+'/application/o/token/'){
   const payload={iss:issuer,aud:site+'-web',sub:'same-subject',
    nonce:nonceBySite.get(site),iat:Math.floor(NOW/1000)-10,exp:Math.floor(NOW/1000)+240}
   const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url')
   const data=b64({alg:'RS256',typ:'JWT',kid:'fixture-'+site})+'.'+b64(payload)
   const id_token=data+'.'+sign('RSA-SHA256',Buffer.from(data),keys[index].privateKey).toString('base64url')
   return {ok:true,json:async()=>({token_type:'Bearer',id_token})}
  }
  throw Error('unregistered OIDC request')
 }
 const runtime=make({sites:config(db.queries),fetchImpl})
 assert.equal(runtime.enabled,true)
 assert.equal(runtime.handlerFor('other'),null)
 const ports={}
 for(const id of IDS)ports[id]=await serve(t,runtime.handlerFor(id))
 const statuses=[]
 for(const id of IDS){
  const login=await call(ports[id],id)
  assert.equal(login.status,200)
  assert.match(login.body,new RegExp(id==='family'?'Family HomeLab':'TechTactics'))
  const start=await call(ports[id],id,{path:'/auth/start'})
  assert.equal(start.status,302)
  const location=new URL(start.headers.location)
  assert.equal(location.origin,identityOrigin(id))
  assert.equal(location.searchParams.get('redirect_uri'),appOrigin(id)+'/auth/oidc/callback')
  const state=location.searchParams.get('state')
  nonceBySite.set(id,location.searchParams.get('nonce'))
  assert.match(state,/^[A-Za-z0-9_-]{43}$/)
  assert.equal(db.stores[IDS.indexOf(id)].transactions.size,1)
  const cookie=start.headers['set-cookie'][0].split(';')[0]
  const other=IDS.find(otherId=>otherId!==id)
  const mismatched=await call(ports[other],other,{
   path:'/auth/oidc/callback?state='+state+'&code=fixture-code',headers:{cookie},
  })
  assert.equal(mismatched.status,403)
  // The wrong-site callback must never consume the initiating site's state.
  assert.equal(db.stores[IDS.indexOf(id)].transactions.size,1)
  const callback=await call(ports[id],id,{
   path:'/auth/oidc/callback?state='+state+'&code=fixture-code',headers:{cookie},
  })
  assert.equal(callback.status,303)
  assert.equal(callback.headers.location,'/account')
  const sessionCookie=callback.headers['set-cookie'][1].split(';')[0]
  const account=await call(ports[id],id,{path:'/account',headers:{cookie:sessionCookie}})
  assert.equal(account.status,200)
  const csrf=account.body.match(/name="csrfToken" value="([^"]+)"/)?.[1]
  assert.match(csrf,/^[A-Za-z0-9_-]{43}$/)
  const replay=await call(ports[id],id,{
   path:'/auth/oidc/callback?state='+state+'&code=fixture-code',headers:{cookie},
  })
  assert.equal(replay.status,403)
  const logout=await call(ports[id],id,{method:'POST',path:'/auth/logout',
   headers:{cookie:sessionCookie,origin:appOrigin(id),'content-type':'application/x-www-form-urlencoded'},
   body:'csrfToken='+csrf,
  })
  assert.equal(logout.status,303)
  assert.equal((await call(ports[id],id,{path:'/account',headers:{cookie:sessionCookie}})).status,403)
  const own=db.stores[IDS.indexOf(id)]
  assert.equal(own.sessions.size,0)
  assert.equal(own.transactions.size,0)
  statuses.push(own.calls.find(item=>item.sql.startsWith('INSERT INTO friday_identity.web_sessions')).params[2])
 }
 assert.notEqual(statuses[0],statuses[1], 'issuer-scoped subjects cannot collapse across sites')
 assert.equal(db.stores[0].calls.every(item=>item.params[0]==='family'),true)
 assert.equal(db.stores[1].calls.every(item=>item.params[0]==='techtactics'),true)
})
