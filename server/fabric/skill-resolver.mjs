import {FabricPolicyError} from './manifest-validation.mjs'
const denied=kind=>{throw new FabricPolicyError(kind)}
const validId=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(x)
export function resolveSkillInstructions({catalog,requiredSkillIds=[],optionalSkillIds=[],taskRequestedSkillIds=[],approvedSkillIds=[],maxChars=12000}={}){
 if(!catalog?.skills||typeof catalog.skills!=='object'||!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>32000)denied('catalog-invalid')
 for(const xs of [requiredSkillIds,optionalSkillIds,taskRequestedSkillIds,approvedSkillIds])if(!Array.isArray(xs)||xs.length>32||xs.some(x=>!validId(x)))denied('catalog-invalid')
 const selected=[],omissions=[],seen=new Set(),resolvedClosures=new Map()
 let chars=0
 function gather(id,path=new Set()){
  if(path.has(id))denied('catalog-invalid')
  if(resolvedClosures.has(id))return resolvedClosures.get(id)
  const skill=catalog.skills[id]
  if(!skill||typeof skill.body!=='string'||!validId(skill.id)||!/^\d+\.\d+\.\d+$/.test(skill.version)||skill.body.length>2000||!Array.isArray(skill.dependencies))denied('catalog-invalid')
  const next=new Set(path);next.add(id)
  const items=[],visited=new Set()
  for(const dependency of skill.dependencies){
   const [depId,depVersion]=dependency.split('@')
   if(!validId(depId)||!/^\d+\.\d+\.\d+$/.test(depVersion)||catalog.skills[depId]?.version!==depVersion)denied('catalog-invalid')
   for(const dependent of gather(depId,next)){
    if(!visited.has(dependent.id)){visited.add(dependent.id);items.push(dependent)}
   }
  }
  if(!visited.has(skill.id))items.push(skill)
  resolvedClosures.set(id,items)
  return items
 }
 function include(id,required,source){
  let closure
  try{closure=gather(id)}catch(e){if(required)throw e;omissions.push({id,reason:'unavailable'});return}
  const uniq=closure.filter((x,i)=>closure.findIndex(y=>y.id===x.id)===i&&!seen.has(x.id))
  if(selected.length+uniq.length>16){
   if(required)denied('catalog-invalid')
   omissions.push({id,reason:'limit'});return
  }
  const newRows=uniq.map(s=>({id:s.id,version:s.version,checksum:s.checksum,source:s.source,required,excerpt:s.body}))
  const newChars=newRows.reduce((n,r)=>n+r.excerpt.length,0)
  if(chars+newChars>maxChars){
   if(required)denied('context-too-large')
   omissions.push({id,reason:'budget'});return
  }
  for(const row of newRows){selected.push(row);seen.add(row.id)}
  chars+=newChars
 }
 for(const id of requiredSkillIds)include(id,true,'required')
 for(const id of optionalSkillIds)include(id,false,'optional')
 for(const id of taskRequestedSkillIds){
  if(!approvedSkillIds.includes(id)){omissions.push({id,reason:'not-approved'});continue}
  include(id,false,'task')
 }
 return {skills:selected,omissions}
}
