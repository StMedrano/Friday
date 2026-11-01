import test from 'node:test'
import assert from 'node:assert/strict'
import {readWebGrowth} from './web-growth.mjs'
const config={enabled:true,baseUrl:'https://reader.example',token:'x'.repeat(32)}
const fixture={schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt:'2026-10-14T12:00:00Z',sourceRevision:'abcdef0',sourceChecksum:'a'.repeat(64),leads:[]}
test('fixed authenticated GET with redirects forbidden and validated projection',async()=>{
 let calls=[]
 const value=await readWebGrowth(config,{fetchImpl:async(...args)=>{calls.push(args);return new Response(JSON.stringify(fixture),{headers:{'content-type':'application/json'}})}})
 assert.deepEqual(value,fixture)
 assert.equal(calls[0][0],'https://reader.example/v1/friday/web-growth')
 assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'error')
 assert.equal(calls[0][1].headers.authorization,'Bearer '+config.token)
})
test('disabled or unsafe config fails before any connection',async()=>{
 for(const patch of [{enabled:false},{baseUrl:'http://infrastructure.example:4317'},{baseUrl:'https://reader.example/api/report'},{baseUrl:'https://user:secret@reader.example'},{token:'short'}]){
 let calls=0
 await assert.rejects(readWebGrowth({...config,...patch},{fetchImpl:async()=>{calls++;throw Error('called')}}))
 assert.equal(calls,0)
 }
})
test('malformed, oversized, unauthorized responses fail with sanitized errors',async()=>{
 for(const response of [new Response('{}'),new Response('private detail',{status:401}),new Response('x'.repeat(1024*1024+1)),new Response(JSON.stringify({...fixture,secret:'private'}))]){
 await assert.rejects(readWebGrowth(config,{fetchImpl:async()=>response}),error=>error.message==='Web Growth unavailable')
 }
})
