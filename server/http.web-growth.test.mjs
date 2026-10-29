import test from 'node:test'
import assert from 'node:assert/strict'
import {createFridayServer} from './http.mjs'
import {getConfig} from './config.mjs'
const snapshot={schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt:'2026-10-14T12:00:00Z',sourceRevision:'abcdef0',sourceChecksum:'a'.repeat(64),leads:[]}
async function run(patch,check){let calls=0
 const server=createFridayServer({config:{mode:'live',ai:{enabled:false},access:{enabled:true,publicOrigin:"https://friday.example"},webGrowth:{enabled:true,readerEmails:['reader@example.test']}},verifyAccessImpl:async()=>({ok:true,email:'reader@example.test',operator:false}),readWebGrowthImpl:async()=>{calls++;return snapshot},...patch})
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
 try{await check('http://127.0.0.1:'+server.address().port,()=>calls)}finally{await new Promise(r=>server.close(r))}
}
test('private read requires verified identity and explicit project reader grant',async()=>{
 for(const patch of [{verifyAccessImpl:async()=>({ok:false,status:401})},{verifyAccessImpl:async()=>({ok:true,email:'other@example.test',operator:true})},{config:{mode:'mock',ai:{enabled:false},webGrowth:{enabled:true,readerEmails:['reader@example.test']}}}]){
 await run(patch,async(base,calls)=>{assert.ok([401,403,503].includes((await fetch(base+'/api/web-growth')).status));assert.equal(calls(),0)})
 }
})
test('authorized named reader receives validated no-store snapshot only',async()=>{
 await run({},async(base,calls)=>{const response=await fetch(base+'/api/web-growth');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),snapshot);assert.equal(calls(),1)})
})
test('authority query and write attempts denied before backend access',async()=>{
 await run({},async(base,calls)=>{assert.equal((await fetch(base+'/api/web-growth?actor=admin')).status,400);assert.equal((await fetch(base+'/api/web-growth',{method:'POST'})).status,405);assert.equal(calls(),0)})
})
test('unavailable or unvalidated private data returns no sensitive error or fabricated empty data',async()=>{
 for(const readWebGrowthImpl of [async()=>{throw Error('secret')},async()=>({...snapshot,private:'secret'})])await run({readWebGrowthImpl},async(base)=>{const response=await fetch(base+'/api/web-growth');assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret|leads/)} )
})
test('private connection disabled and grants empty by default',()=>{assert.deepEqual(getConfig({}).webGrowth,{enabled:false,baseUrl:'',token:'',readerEmails:[]})})
test('real signed fixture Access identity still requires the explicit private reader grant',async()=>{
 const {generateKeyPairSync,sign}=await import('node:crypto')
 const {createCloudflareAccessVerifier}=await import('./security/cloudflare-access.mjs')
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
 const issuer='https://fixture.cloudflareaccess.com',audience='private-reader-fixture',now=Math.floor(Date.now()/1000)
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
 const content=encode({alg:'RS256',kid:'reader-test',typ:'JWT'})+'.'+encode({iss:issuer,aud:[audience],iat:now-1,nbf:now-1,exp:now+60,type:'app',sub:'fixture-reader',email:'reader@example.test'})
 const token=content+'.'+sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url')
 const jwk={...publicKey.export({format:'jwk'}),kid:'reader-test',alg:'RS256',use:'sig'}
 const verifyAccessImpl=createCloudflareAccessVerifier({fetchImpl:async()=>new Response(JSON.stringify({keys:[jwk]}))})
 for(const readerEmails of [[],['reader@example.test']])await run({config:{mode:'live',ai:{enabled:false},access:{enabled:true,issuer,audience,publicOrigin:"https://friday.example",operatorEmails:[]},webGrowth:{enabled:true,readerEmails}},verifyAccessImpl},async(base,calls)=>{
  assert.equal((await fetch(base+'/api/web-growth')).status,401);assert.equal(calls(),0)
  const response=await fetch(base+'/api/web-growth',{headers:{'cf-access-jwt-assertion':token}})
  assert.equal(response.status,readerEmails.length?200:403);assert.equal(calls(),readerEmails.length?1:0)
 })
})
