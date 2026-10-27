import {createHash} from 'node:crypto'

const fail=()=>{throw Error('four-project-catalog-denied')}
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k))
const ID=/^[a-z][a-z0-9-]{1,63}$/

// These are explicit owner-selected NEW catalog IDs, not guesses at existing
// database records. They acquire authority only AFTER a real DB read verifies
// matching id/name pairs from public.friday_projects on the correct VM132.
export const FOUR_PROJECT_CATALOG=Object.freeze([
 Object.freeze({id:'friday-ai-os',name:'Friday AI OS'}),
 Object.freeze({id:'techtactics',name:'TechTactics'}),
 Object.freeze({id:'web-growth-agents',name:'Web Growth Agents'}),
 Object.freeze({id:'app-builder',name:'App Builder'}),
])
const KEYS=FOUR_PROJECT_CATALOG.map(p=>p.id)
const names=new Set(FOUR_PROJECT_CATALOG.map(p=>p.name))

function checkedRows(rows){
 if(!Array.isArray(rows)||rows.length>100)fail()
 const seen=new Set(),seenNames=new Set()
 for(const row of rows){
  if(!exact(row,['id','name'])||typeof row.id!=='string'||!ID.test(row.id)||
     typeof row.name!=='string'||!row.name.trim()||row.name.length>160||
     seen.has(row.id)||seenNames.has(row.name))fail()
  seen.add(row.id)
  seenNames.add(row.name)
  const existing=FOUR_PROJECT_CATALOG.find(p=>p.id===row.id)
  if(existing&&existing.name!==row.name)fail()
  if(names.has(row.name)&&!existing)fail()
 }
 return rows
}
function catalogState(rows){
 checkedRows(rows)
 const existing=FOUR_PROJECT_CATALOG.filter(p=>rows.some(r=>r.id===p.id))
 const missing=FOUR_PROJECT_CATALOG.filter(p=>!rows.some(r=>r.id===p.id))
 return {existing,missing}
}

export function verifyFourProjectCatalog(rows){
 const {existing,missing}=catalogState(rows)
 if(missing.length||existing.length!==4)fail()
 return Object.fromEntries(FOUR_PROJECT_CATALOG.map(p=>[p.id,p.id]))
}
const digest=rows=>createHash('sha256').update(JSON.stringify(
 [...rows].sort((a,b)=>a.id.localeCompare(b.id)),
)).digest('hex')

/**
 * Staged, internal-only project catalog registrar.
 * inspect() never writes and returns a fingerprint of a bounded exact
 * id/name snapshot. apply() is disabled unless opted in by trusted server
 * code, requires a current fingerprint + exact owner approval, inserts ONLY
 * missing rows, and verifies the result. No live runtime imports this module.
 * The injected repo must batch inserts atomically and MUST NOT upsert/update
 * existing project names; a conflict needs explicit human review.
 */
export function createFourProjectCatalogBootstrap({repo,enabled=false}={}){
 const active=enabled===true &&
  typeof repo?.listProjects==='function'&&
  typeof repo?.insertProjects==='function'
 async function inspect(){
  try{
   if(typeof repo?.listProjects!=='function')fail()
   const rows=checkedRows(await repo.listProjects())
   const {existing,missing}=catalogState(rows)
   return Object.freeze({
    status:missing.length?'missing':'ready',
    existing:existing.length,
    missing:missing.map(p=>({...p})),
    ...(active?{fingerprint:digest(rows)}:{}),
   })
  }catch{fail()}
 }
 async function apply(authorization){
  if(!active||!exact(authorization,['approved','fingerprint','request'])||
     authorization.approved!==true||
     authorization.request!=='bootstrap-four-project-catalog'||
     typeof authorization.fingerprint!=='string'||
     !/^[a-f0-9]{64}$/.test(authorization.fingerprint))fail()
  try {
   const plan=await inspect()
   if(plan.fingerprint!==authorization.fingerprint)fail()
   if(plan.missing.length){
    // No delete/update. An outer reviewed deploy must provide a short-lived
    // trusted DB writer and a transactional insert-only implementation.
    await repo.insertProjects(plan.missing.map(p=>({...p})))
   }
   const after=checkedRows(await repo.listProjects())
   verifyFourProjectCatalog(after)
   return Object.freeze({status:'ready',projectIds:verifyFourProjectCatalog(after)})
  }catch{fail()}
 }
 return Object.freeze({enabled:active,inspect,apply})
}
