import {lstat,readdir,readFile,realpath,open} from 'node:fs/promises'
import {constants} from 'node:fs'
import {resolve,relative,sep,posix} from 'node:path'
import {createHash} from 'node:crypto'
import {TextDecoder} from 'node:util'
import {FabricPolicyError,parseManifestJson,validateFabricManifest} from './manifest-validation.mjs'

const defaults={maxFiles:128,maxBytes:1048576,maxManifestBytes:16384,maxSopBytes:2048}
const allowed=(p)=>{
 if(p==='agent-assignments/.gitkeep')return 'placeholder'
 if(/^groups\/[a-z0-9-]+\.json$/.test(p))return 'group'
 if(/^plugin-catalog\/[a-z0-9-]+\.json$/.test(p))return 'plugin'
 if(/^agent-assignments\/[a-z0-9-]+\.json$/.test(p))return 'assignment'
 if(/^skills\/[a-z0-9-]+\/[a-z0-9-]+\/manifest\.json$/.test(p))return 'skill'
 if(/^skills\/[a-z0-9-]+\/[a-z0-9-]+\/SKILL\.md$/.test(p))return 'sop'
 return null
}
const validDir=(p)=>['groups','plugin-catalog','agent-assignments','skills'].includes(p)||
 /^skills\/[a-z0-9-]+$/.test(p)||/^skills\/[a-z0-9-]+\/[a-z0-9-]+$/.test(p)
const failure=()=>{throw new FabricPolicyError('catalog-invalid')}
const decoder=new TextDecoder('utf-8',{fatal:true})
const digest=x=>createHash('sha256').update(x).digest('hex')
function deepFreeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))deepFreeze(v);Object.freeze(x)}return x}
async function safeRead(path){const fh=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!(await fh.stat()).isFile())failure();return await fh.readFile()}finally{await fh.close()}}
export async function loadFabricCatalog({rootDir,sourceCommit='',limits={}}={}){
 try{
  if(typeof rootDir!=='string'||!rootDir||typeof sourceCommit!=='string'||sourceCommit.length>100)failure()
  const limit={...defaults,...limits}
  if(Object.values(limit).some(x=>!Number.isSafeInteger(x)||x<1)||limit.maxBytes>8388608)failure()
  const root=resolve(rootDir)
  if(!(await lstat(root)).isDirectory()||(await realpath(root))!==root)failure()
  const files=[];let total=0
  async function walk(r){
   if(r&&!validDir(r))failure()
   const path=resolve(root,r||'.')
   if((await realpath(path))!==path)failure()
   for(const ent of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(ent.name.startsWith('.')&&!(r==='agent-assignments'&&ent.name==='.gitkeep'))failure()
    if(r==='skills'&&ent.isDirectory()&&!['engineering','shared','security'].includes(ent.name))continue
    const relativePath=r?r+'/'+ent.name:ent.name
    const full=resolve(root,relativePath)
    if(relative(root,full).startsWith('..'+sep)||relative(root,full)==='..')failure()
    const st=await lstat(full)
    if(st.isSymbolicLink())failure()
    if(st.isDirectory()){
     if(!validDir(relativePath))failure()
     await walk(relativePath)
    }else if(st.isFile()){
     const type=allowed(relativePath)
     if(!type||st.size>Math.min(limit.maxBytes,type==='sop'?limit.maxSopBytes:limit.maxManifestBytes))failure()
     total+=st.size
     if(total>limit.maxBytes||files.length>=limit.maxFiles)failure()
     const bytes=await safeRead(full)
     if(bytes.length!==st.size)failure()
     files.push({name:relativePath,type,bytes,checksum:digest(bytes)})
    }else failure()
   }
  }
  for(const folder of ['groups','skills','plugin-catalog','agent-assignments']){
   const st=await lstat(resolve(root,folder));if(!st.isDirectory()||st.isSymbolicLink())failure()
   await walk(folder)
  }
  const groups=Object.create(null),skills=Object.create(null),plugins=Object.create(null),assignments=Object.create(null)
  const bodies=new Map()
  for(const entry of files){
   if(entry.type==='placeholder')continue
   const text=decoder.decode(entry.bytes)
   if(entry.type==='sop'){
    if(text.length>limit.maxSopBytes||/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text)||
       /(?:-----BEGIN|bearer\s+[\w.-]{6,}|(?:password|api_key|secret|token)\s*[:=])/i.test(text))failure()
    bodies.set(entry.name,text);continue
   }
   const row=validateFabricManifest(entry.type,parseManifestJson(entry.bytes))
   const key=entry.type==='assignment'?row.agentId:row.id
   const obj={group:groups,skill:skills,plugin:plugins,assignment:assignments}[entry.type]
   if(Object.hasOwn(obj,key))failure()
   if(entry.type==='skill'){
    const dirname=posix.dirname(entry.name),sop=dirname+'/SKILL.md'
    obj[key]={...row,source:entry.name,checksum:entry.checksum,sop}
   }else obj[key]={...row,source:entry.name,checksum:entry.checksum}
  }
  for(const [key,skill] of Object.entries(skills)){
   if(!bodies.has(skill.sop)||posix.basename(posix.dirname(skill.sop))!==key)failure()
   const body=bodies.get(skill.sop)
   skills[key]={...skill,body,checksum:digest(skill.checksum+':'+digest(body))}
   for(const dep of skill.dependencies)if(!skills[dep.split('@')[0]]||skills[dep.split('@')[0]].version!==dep.split('@')[1])failure()
  }
  // A capability must have one authoritative plugin/risk descriptor.
  // Duplicate declarations can otherwise launder an enabled low-risk alias
  // for a disabled or high-risk plugin.
  const catalogCapabilities=new Set()
  for(const plugin of Object.values(plugins)){
   for(const capability of plugin.capabilities){
    if(catalogCapabilities.has(capability))failure()
    catalogCapabilities.add(capability)
   }
  }
  for(const g of Object.values(groups)){
   for(const id of [...g.requiredSkills,...g.optionalSkills])if(!skills[id])failure()
   for(const c of g.allowedPluginCapabilities){
    if(!Object.values(plugins).some(p=>p.capabilities.includes(c)))failure()
   }
  }
  for(const a of Object.values(assignments)){
   if(!groups[a.groupId])failure()
   for(const s of a.skills)if(!skills[s])failure()
   for(const c of a.allowedPluginCapabilities)if(!Object.values(plugins).some(p=>p.capabilities.includes(c)))failure()
  }
  const policyHash=digest(files.sort((a,b)=>a.name.localeCompare(b.name)).map(f=>f.name+':'+f.checksum).join('\n'))
  return deepFreeze({status:'ok',sourceCommit,policyHash,catalog:{groups,skills,plugins,assignments,policyHash,sourceCommit}})
 }catch{failure()}
}
