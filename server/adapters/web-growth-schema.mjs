const stages = new Set(['new','audited','qualified','demo_ready','approved','contacted','responded','proposal','won','lost'])
const statuses = new Set(['pending','needs_review','sent'])
const snapshotKeys=['schemaVersion','projectId','generatedAt','sourceRevision','sourceChecksum','leads']
const leadKeys=['id','businessName','stage','discoveredAt','updatedAt','approvedForOutreach','approvedOutreachGeneratedAt','outreachStatus','outreachSentAt','score','auditCheckedAt','proposalAvailable','demoAvailable']
const fail=()=>{throw new Error('Invalid Web Growth data')}
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value)
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max
const date=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))) return false
 const [year,month,day]=value.slice(0,10).split('-').map(Number)
 const days=new Date(Date.UTC(year,month,0)).getUTCDate()
 return month>=1&&month<=12&&day>=1&&day<=days&&Number(value.slice(11,13))<24&&Number(value.slice(14,16))<60&&Number(value.slice(17,19))<60
}
const optionalDate=value=>value===null||date(value)
export function validateWebGrowthSnapshot(value) {
 if(!exact(value,snapshotKeys)||value.schemaVersion!=='1'||value.projectId!=='techtactics-web-growth'||!date(value.generatedAt)||!/^([a-f0-9]{7,40})$/.test(value.sourceRevision)||typeof value.sourceRevision!=='string'||typeof value.sourceChecksum!=='string'||! /^[a-f0-9]{64}$/.test(value.sourceChecksum)||!Array.isArray(value.leads)||value.leads.length>1000) fail()
 const ids=new Set()
 const leads=value.leads.map(lead=>{
  if(!exact(lead,leadKeys)||!string(lead.id,128)||ids.has(lead.id)||!string(lead.businessName,256)||!stages.has(lead.stage)||!date(lead.discoveredAt)||!date(lead.updatedAt)||typeof lead.approvedForOutreach!=='boolean'||!optionalDate(lead.approvedOutreachGeneratedAt)||!(lead.outreachStatus===null||statuses.has(lead.outreachStatus))||!optionalDate(lead.outreachSentAt)||!(lead.score===null||(typeof lead.score==='number'&&Number.isFinite(lead.score)&&lead.score>=0&&lead.score<=100))||!optionalDate(lead.auditCheckedAt)||typeof lead.proposalAvailable!=='boolean'||typeof lead.demoAvailable!=='boolean') fail()
  ids.add(lead.id)
  return Object.fromEntries(leadKeys.map(key=>[key,lead[key]]))
 })
 return {schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt:value.generatedAt,sourceRevision:value.sourceRevision,sourceChecksum:value.sourceChecksum,leads}
}
export function projectWebGrowthStore(store,{sourceRevision,sourceChecksum,generatedAt}={}) {
 if(!object(store)||store.version!==1||!Array.isArray(store.leads)||store.leads.length>1000) fail()
 const leads=store.leads.map(lead=>{
  if(!object(lead)) fail()
  for(const key of ['outreachSend','score','audit','salesAssets']) if(lead[key]!==undefined&&!object(lead[key])) fail()
  if(lead.demoPath!==undefined&&typeof lead.demoPath!=='string') fail()
  if(lead.salesAssets?.proposalMarkdown!==undefined&&typeof lead.salesAssets.proposalMarkdown!=='string') fail()
  return {id:lead.id,businessName:lead.businessName,stage:lead.stage,discoveredAt:lead.discoveredAt,updatedAt:lead.updatedAt,approvedForOutreach:lead.approvedForOutreach,approvedOutreachGeneratedAt:lead.approvedOutreachGeneratedAt??null,outreachStatus:lead.outreachSend===undefined?null:lead.outreachSend.status,outreachSentAt:lead.outreachSend?.sentAt??null,score:lead.score===undefined?null:lead.score.total,auditCheckedAt:lead.audit===undefined?null:lead.audit.checkedAt,proposalAvailable:typeof lead.salesAssets?.proposalMarkdown==='string'&&lead.salesAssets.proposalMarkdown.trim().length>0,demoAvailable:typeof lead.demoPath==='string'&&lead.demoPath.trim().length>0}
 })
 return validateWebGrowthSnapshot({schemaVersion:'1',projectId:'techtactics-web-growth',generatedAt,sourceRevision,sourceChecksum,leads})
}
