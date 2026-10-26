const ROLES=new Set(['Viewer','Operator','Administrator','Friday Agent'])
const SUBJECT=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/
const TARGET=/^[a-z0-9][a-z0-9-]{1,63}$/
const PERMISSIONS=Object.freeze({
 Viewer:new Set(['diagnostics.read']),
 Operator:new Set(['diagnostics.read','action.propose']),
 Administrator:new Set(['diagnostics.read','action.propose','action.approve']),
 'Friday Agent':new Set(['diagnostics.read']),
})
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k))
const valid=(value,re)=>typeof value==='string'&&re.test(value)

// Internal trusted snapshot supplied by server-side configuration, never
// reconstructed from a request, assistant response, group policy, or JWT role.
// A missing or malformed snapshot has zero effective grants.
export function createOperatorRolePolicy(input={}) {
 const grants=new Map()
 let configured=false
 try {
  if(!exact(input,['bindings'])||!Array.isArray(input.bindings)||
    input.bindings.length<1||input.bindings.length>100)throw Error('invalid-policy')
  for(const row of input.bindings){
   if(!exact(row,['subject','role','targets'])||!valid(row.subject,SUBJECT)||
     !ROLES.has(row.role)||!Array.isArray(row.targets)||row.targets.length<1||row.targets.length>32||
     grants.has(row.subject))throw Error('invalid-policy')
   const targets=new Set()
   for(const target of row.targets){
    if(!valid(target,TARGET)||targets.has(target))throw Error('invalid-policy')
    targets.add(target)
   }
   grants.set(row.subject,Object.freeze({role:row.role,targets}))
  }
  configured=true
 }catch{grants.clear()}
 return Object.freeze({
  configured,
  permits(identity,permission,target){
   if(!configured||!identity||typeof identity!=='object'||Array.isArray(identity)||
      identity.kind==='service'||(identity.kind!==undefined&&identity.kind!=='human')||
      !valid(identity.subject,SUBJECT)||!valid(target,TARGET)||typeof permission!=='string')return false
   const binding=grants.get(identity.subject)
   return Boolean(binding?.targets.has(target)&&PERMISSIONS[binding.role].has(permission))
  },
 })
}
