import {normalizeActor} from '../work/validation.mjs'
import {FabricPolicyError} from './manifest-validation.mjs'
const fail=()=>{throw new FabricPolicyError('not-authorized')}
const allowedScopes=new Set(['global','organization','project','group','agent','task','session'])
const id=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/
const key=x=>x.scope+'\0'+x.ownerId
const arr=x=>Array.isArray(x)?x:[]
function validPair(x){return x&&typeof x==='object'&&!Array.isArray(x)&&
 allowedScopes.has(x.scope)&&typeof x.ownerId==='string'&&id.test(x.ownerId)&&!x.ownerId.includes('..')}
export function resolveMemoryScopes({actor,workItem,groupId,agentId,assignment,serverCeilings,taskPolicy,groupScopes=[]}={}){
 let a
 try{a=normalizeActor(actor)}catch{fail()}
 if(!workItem||typeof workItem.id!=='string'||!workItem.id||
    typeof workItem.projectId!=='string'||!a.allowedProjectIds.includes(workItem.projectId)||
    typeof groupId!=='string'||!groupId||typeof agentId!=='string'||!a.allowedAgentIds.includes(agentId)||
    assignment?.agentId!==agentId||assignment.groupId!==groupId)fail()
 const actorGrants=arr(a.allowedMemoryScopes).filter(validPair)
 const assignmentGrants=arr(assignment.allowedMemoryScopes).filter(validPair)
 const serverGrants=arr(serverCeilings?.allowedMemoryScopes).filter(validPair)
 const taskGrants=arr(taskPolicy?.allowedMemoryScopes).filter(validPair)
 const by=(values)=>new Set(values.map(key))
 const permitted=actorGrants.filter(x=>{
  if(!arr(groupScopes).includes(x.scope))return false
  if(!validPair(x))return false
  if(x.scope==='project'&&x.ownerId!==workItem.projectId)return false
  if(x.scope==='task'&&x.ownerId!==workItem.id)return false
  if(x.scope==='group'&&x.ownerId!==groupId)return false
  if(x.scope==='agent'&&x.ownerId!==agentId)return false
  if(x.scope==='session'&&serverCeilings?.sessionOwnerByPrincipal?.[a.principalId]!==x.ownerId)return false
  return true
 })
 const assignmentSet=by(assignmentGrants),serverSet=by(serverGrants),taskSet=by(taskGrants)
 const seen=new Set(),out=[]
 for(const pair of permitted){
  const k=key(pair)
  if(!seen.has(k)&&assignmentSet.has(k)&&serverSet.has(k)&&taskSet.has(k)){
   seen.add(k);out.push({scope:pair.scope,ownerId:pair.ownerId})
  }
 }
 if(out.length>30)fail()
 return out.sort((x,y)=>key(x).localeCompare(key(y)))
}
