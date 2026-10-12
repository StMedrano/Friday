import test from 'node:test'
import assert from 'node:assert/strict'
import {checkAnonymousAccess} from './check-friday-edge-readiness.mjs'

test('edge preflight rejects unauthenticated public 200 on homepage, inventory and agents',async()=>{
 const data=await checkAnonymousAccess({fetchImpl:async()=>new Response('',{status:200})})
 assert.equal(data.safe,false)
 assert.equal(data.results.length,3)
 assert.ok(data.results.every(x=>!x.closed))
})
test('edge preflight accepts denial and Cloudflare Access login redirects without logging JWTs',async()=>{
 const statuses=[302,401,403]
 let counter=0
 const data=await checkAnonymousAccess({fetchImpl:async()=>new Response(null,{status:statuses[counter++],headers:{location:'https://example.cloudflareaccess.com/cdn-cgi/access/login?secret=fake', 'set-cookie':'jwt=fake'}})})
 assert.equal(data.safe,true)
 assert.equal(counter,3)
 assert.ok(data.results.every(x=>!('redirect' in x)&&!('body' in x)))
})
test('edge preflight does not treat network errors or unrecognized response codes as evidence',async()=>{
 const data=await checkAnonymousAccess({fetchImpl:async()=>{throw Error('down')}})
 assert.equal(data.safe,false)
 assert.equal(data.results[0].reason,'network-error')
})
test('edge preflight rejects insecure origins and credentials',async()=>{
 for(const origin of ['http://example.com','https://user:password@example.com/','https://example.com:444/','https://example.com/query']){
  await assert.rejects(checkAnonymousAccess({origin,fetchImpl:async()=>new Response(null,{status:403})}))
 }
})

test('edge preflight rejects a generic 302, HTTP 404 and 503 as non-evidence',async()=>{
 let i=0
 const codes=[302,404,503]
 const result=await checkAnonymousAccess({fetchImpl:async()=>new Response(null,{status:codes[i++],headers:{location:'https://example.com/welcome'}})})
 assert.equal(result.safe,false)
 assert.ok(result.results.every(r=>r.closed===false))
})
