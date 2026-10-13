import {FabricPolicyError} from './manifest-validation.mjs'
const fail=kind=>{throw new FabricPolicyError(kind)}
const secret=/(?:-----BEGIN [\w ]*PRIVATE KEY-----|authorization\s*[:=]|bearer\s+[a-zA-Z0-9._-]{6,}|(?:api[_-]?key|secret|password|token)\s*[:=]|sk-[\w-]{8,})/i
const dangerousControls=/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/
function unsafe(value){
 // Inspect raw strings before JSON.stringify escapes invisible characters.
 const stack=[value],seen=new Set()
 let inspected=0
 while(stack.length){
  if(++inspected>2000)return true
  const item=stack.pop()
  if(typeof item==='string'){
   if(secret.test(item)||dangerousControls.test(item))return true
  }else if(item&&typeof item==='object'){
   if(seen.has(item))return true
   seen.add(item)
   for(const [key,entry] of Object.entries(item)){stack.push(key,entry)}
  }
 }
 return false
}
const str=x=>typeof x==='string'?x:''
const omissions=()=>({budget:0,secret:0,limit:0,truncated:0})
function normalizeOptional(item){
 if(item?.field==='memory'){
  const row=item.value
  if(!row||typeof row.id!=='string'||typeof row.excerpt!=='string'||unsafe(row))return {kind:'secret'}
  const excerpt=row.excerpt.slice(0,1000)
  return {kind:'memory',truncated:row.excerpt.length>1000,value:{
   id:row.id,scope:str(row.scope),ownerId:str(row.ownerId),excerpt,provenance:str(row.provenance).slice(0,250),trust:'advisory'
  }}
 }
 if(item?.field==='latestHandoff'){
  const row=item.value
  if(!row||typeof row.summary!=='string'||unsafe(row))return {kind:'secret'}
  return {kind:'latestHandoff',truncated:row.summary.length>2000,value:{
   summary:row.summary.slice(0,2000),
   recommendedNextCapability:str(row.recommendedNextCapability).slice(0,128),
   trust:'advisory'
  }}
 }
 return {kind:'secret'}
}
export function serializeSafeContext({mandatory,optional=[],maxChars=12000}={}){
 if(!Number.isSafeInteger(maxChars)||maxChars<256||maxChars>32000||!mandatory||
    typeof mandatory!=='object'||Array.isArray(mandatory)||!Array.isArray(optional)||optional.length>100)fail('invalid-input')
 if(unsafe(mandatory))fail('storage-unavailable')
 const {memory:_discardMemory,latestHandoff:_discardHandoff,omissions:_discardOmissions,...trusted}=mandatory
 const result={...trusted,latestHandoff:null,memory:[],omissions:omissions()}
 if(JSON.stringify(result).length>maxChars)fail('context-too-large')
 for(const item of optional){
  const row=normalizeOptional(item)
  if(row.kind==='secret'){result.omissions.secret++;continue}
  if(row.kind==='memory'&&result.memory.length>=20){result.omissions.limit++;continue}
  const previousHandoff=result.latestHandoff
  const previousMemories=result.memory.length
  if(row.kind==='memory')result.memory.push(row.value)
  else result.latestHandoff=row.value
  if(JSON.stringify(result).length>maxChars){
   if(row.kind==='memory')result.memory.length=previousMemories
   else result.latestHandoff=previousHandoff
   result.omissions.budget++
  }else if(row.truncated)result.omissions.truncated++
 }
 // Counts are included in the bound, not subtracted from an estimate.
 while(JSON.stringify(result).length>maxChars&&result.memory.length){result.memory.pop();result.omissions.budget++}
 if(JSON.stringify(result).length>maxChars&&result.latestHandoff){result.latestHandoff=null;result.omissions.budget++}
 if(JSON.stringify(result).length>maxChars)fail('context-too-large')
 return result
}
