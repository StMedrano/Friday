import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWebGrowthStore, validateWebGrowthSnapshot } from './web-growth-schema.mjs'
const date='2026-10-14T12:00:00.000Z'
const meta={sourceRevision:'abcdef0',sourceChecksum:'a'.repeat(64),generatedAt:date}
const lead={id:'one',businessName:'Business',stage:'new',discoveredAt:date,updatedAt:date,approvedForOutreach:false}
test('projection excludes private source fields and supplies honest absent fields',()=>{
 const snapshot=projectWebGrowthStore({version:1,leads:[{...lead,contactEmail:'secret',notes:'secret',salesAssets:{proposalMarkdown:'private'}}]},meta)
 assert.equal(snapshot.leads[0].proposalAvailable,true)
 assert.equal(snapshot.leads[0].score,null)
 assert.equal(snapshot.leads[0].approvedForOutreach,false)
 assert.equal(JSON.stringify(snapshot).includes('secret'),false)
 assert.equal(JSON.stringify(snapshot).includes('private'),false)
 assert.deepEqual(validateWebGrowthSnapshot(snapshot),snapshot)
})
test('rejects malformed versions, duplicate IDs, bounds and invalid optional values',()=>{
 for(const store of [{version:2,leads:[]},{version:1,leads:[lead,lead]},{version:1,leads:Array(1001).fill(lead)},{version:1,leads:[{...lead,score:{total:101}}]},{version:1,leads:[{...lead,outreachSend:{status:'unknown'}}]},{version:1,leads:[{...lead,updatedAt:'bad'}]}]) assert.throws(()=>projectWebGrowthStore(store,meta),/^Error: Invalid Web Growth data$/)
})
test('canonical validation rejects additional fields and wrong provenance',()=>{
 const snapshot=projectWebGrowthStore({version:1,leads:[lead]},meta)
 for(const value of [{...snapshot,secret:'x'},{...snapshot,sourceRevision:'ABCDEF0'},{...snapshot,leads:[{...snapshot.leads[0],contactEmail:'x'}]}]) assert.throws(()=>validateWebGrowthSnapshot(value))
})

test('impossible calendar dates are rejected',()=>{
 assert.throws(()=>projectWebGrowthStore({version:1,leads:[{...lead,discoveredAt:'2026-02-30T12:00:00Z'}]},meta))
})
