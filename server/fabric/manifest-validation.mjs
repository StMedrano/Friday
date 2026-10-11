import {TextDecoder} from 'node:util'

export class FabricPolicyError extends Error {
 constructor(kind='catalog-invalid'){super('Friday fabric catalog unavailable');this.name='FabricPolicyError';this.kind=kind}
}
const fail=()=>{throw new FabricPolicyError()}
const id=/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const cap=/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const owner=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/
const scopes=new Set(['global','organization','project','group','agent','task','session'])
const secret=/(authorization\s*[:=]|bearer\s+[\w.-]{6,}|-----BEGIN|(?:api[_-]?key|secret|password|token)\s*[:=]|sk-[\w-]{8,})/i
const decoder=new TextDecoder('utf-8',{fatal:true})
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[null,Object.prototype].includes(Object.getPrototypeOf(x))
function fields(v,names){if(!plain(v)||Object.keys(v).some(x=>!names.includes(x)))fail()}
function isText(x,max=500){if(typeof x!=='string'||!x.trim()||x.length>max||/[\u0000-\u001f\u007f]/.test(x)||secret.test(x))fail();return x}
function validId(x){if(typeof x!=='string'||!id.test(x))fail();return x}
function validCap(x){if(typeof x!=='string'||!cap.test(x))fail();return x}
function list(v,check,max=32){if(!Array.isArray(v)||v.length>max)fail();const seen=new Set();return v.map(x=>{const y=check(x);if(seen.has(y))fail();seen.add(y);return y})}
function frozen(v){if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v)}return v}
function exactVersion(v){if(v!=='1')fail()}
function bool(v){if(typeof v!=='boolean')fail();return v}
function scope(v){if(!scopes.has(v))fail();return v}
function pair(v){fields(v,['scope','ownerId']);scope(v.scope);if(typeof v.ownerId!=='string'||!owner.test(v.ownerId)||v.ownerId==='*'||v.ownerId.includes('..'))fail();return {scope:v.scope,ownerId:v.ownerId}}

// Parse enough of the JSON grammar to enforce unique decoded member keys
// before JSON.parse, which otherwise silently overwrites duplicate grants.
export function parseManifestJson(input) {
 try {
  const s=Buffer.isBuffer(input)||input instanceof Uint8Array?decoder.decode(input):input
  if(typeof s!=='string'||Buffer.byteLength(s)>1024*1024||s.startsWith('\ufeff'))fail()
  let i=0
  function ws(){while(/[\t\n\r ]/.test(s[i]||'' )&&i<s.length)i++}
  function quoted(){
   const start=i
   if(s[i++]!=='"')fail()
   let done=false
   while(i<s.length){
    const ch=s[i++]
    if(ch==='"'){done=true;break}
    if(ch==='\\'){if(i>=s.length)fail();const esc=s[i++];if(!'"/\\bfnrtu'.includes(esc))fail();if(esc==='u'){if(!/^[a-fA-F0-9]{4}$/.test(s.slice(i,i+4)))fail();i+=4}}
    else if(ch.charCodeAt(0)<32)fail()
   }
   if(!done)fail()
   const x=JSON.parse(s.slice(start,i))
   if(x==='__proto__'||x==='constructor'||x==='prototype')fail()
   return x
  }
  function value(depth){
   if(depth>32)fail()
   ws()
   if(s[i]==='{'){
    i++;ws();const seen=new Set()
    if(s[i]==='}'){i++;return}
    for(;;){
     ws();const key=quoted();if(seen.has(key))fail();seen.add(key)
     ws();if(s[i++]!==':')fail()
     value(depth+1);ws()
     if(s[i]==='}'){i++;break}
     if(s[i++]!==',')fail()
    }
   }else if(s[i]==='['){
    i++;ws()
    if(s[i]===']'){i++;return}
    for(;;){value(depth+1);ws();if(s[i]===']'){i++;break}if(s[i++]!==',')fail()}
   }else if(s[i]==='"')quoted()
   else {
    const part=s.slice(i).match(/^(?:true|false|null|-(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)
    if(!part)fail()
    i+=part[0].length
   }
  }
  value(0);ws();if(i!==s.length)fail()
  const data=JSON.parse(s)
  if(!plain(data))fail()
  return data
 }catch{fail()}
}
export function validateFabricManifest(kind,input) {
 try {
  if(!['group','skill','plugin','assignment'].includes(kind))fail()
  const x=structuredClone(input)
  if(kind==='group'){
   fields(x,['schemaVersion','id','requiredSkills','optionalSkills','allowedPluginCapabilities','deniedPluginCapabilities','memoryScopes','requiredProcessRules'])
   exactVersion(x.schemaVersion);validId(x.id)
   list(x.requiredSkills,validId);list(x.optionalSkills,validId)
   list(x.allowedPluginCapabilities,validCap);list(x.deniedPluginCapabilities,validCap)
   list(x.memoryScopes,scope);list(x.requiredProcessRules,validId)
  }else if(kind==='skill'){
   fields(x,['schemaVersion','id','version','instructionFile','description','required','dependencies'])
   exactVersion(x.schemaVersion);validId(x.id)
   if(typeof x.version!=='string'||!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(x.version))fail()
   if(x.instructionFile!=='SKILL.md')fail()
   isText(x.description,200);bool(x.required)
   list(x.dependencies,dep=>{fields(dep,['id','version']);validId(dep.id);if(!/^\d+\.\d+\.\d+$/.test(dep.version))fail();return dep.id+'@'+dep.version})
  }else if(kind==='plugin'){
   fields(x,['schemaVersion','id','capabilities','risk','connectionType','enabled','description'])
   exactVersion(x.schemaVersion);validId(x.id);list(x.capabilities,validCap)
   if(!['low','medium','high'].includes(x.risk)||!['internal','mcp','api'].includes(x.connectionType))fail()
   bool(x.enabled);isText(x.description,200)
  }else{
   fields(x,['schemaVersion','agentId','groupId','skills','allowedPluginCapabilities','deniedPluginCapabilities','allowedMemoryScopes'])
   exactVersion(x.schemaVersion);validId(x.agentId);validId(x.groupId);list(x.skills,validId)
   list(x.allowedPluginCapabilities,validCap);list(x.deniedPluginCapabilities,validCap)
   list(x.allowedMemoryScopes,y=>JSON.stringify(pair(y)))
  }
  return frozen(x)
 }catch{fail()}
}
