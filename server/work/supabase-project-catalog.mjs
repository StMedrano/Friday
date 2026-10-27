import {FOUR_PROJECT_CATALOG} from './four-project-catalog.mjs'

const fail=()=>{throw Error('four-project-catalog-denied')}
const MAX_BYTES=32768
const idName=row=>row!==null&&typeof row==='object'&&!Array.isArray(row)&&
 Object.keys(row).length===2&&Object.hasOwn(row,'id')&&Object.hasOwn(row,'name')&&
 typeof row.id==='string'&&/^[a-z][a-z0-9-]{1,63}$/.test(row.id)&&
 typeof row.name==='string'&&row.name.length>=1&&row.name.length<=160
const rootFrom=url=>{
 try{
  const parsed=new URL(url)
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||
     parsed.hash||(parsed.pathname!=='/'&&parsed.pathname!=='')||
     !parsed.hostname||parsed.port)return ''
  return parsed.origin
 }catch{return ''}
}

/**
 * Private server-only adapter for public.friday_projects. No runtime import.
 * GET exposes only id/name. Insert is opt-in and accepts exact subsets of
 * the reviewed four-project catalog; it never updates/deletes anything.
 * Credentials are read only from the server-side constructor arguments.
 * The real deployment must use a trusted fixed VM132 Supabase origin, never
 * an untrusted URL from HTTP, browser or an AI response.
 */
export function createSupabaseProjectCatalogRepository({
 baseUrl,serviceKey,fetchImpl=globalThis.fetch,timeoutMs=5000,allowInsert=false,
}={}){
 const root=rootFrom(baseUrl)
 const key=typeof serviceKey==='string'&&serviceKey.length>=1?serviceKey:''
 async function remote(method,path,body){
  if(!root||!key||typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||
     timeoutMs<100||timeoutMs>15000)fail()
  let result,raw
  try{
   result=await fetchImpl(root+path,{
    method,redirect:'error',headers:{
     accept:'application/json',apikey:key,authorization:'Bearer '+key,
     ...(body!==undefined?{'content-type':'application/json',prefer:'return=representation'}:{}),
    },
    signal:AbortSignal.timeout(timeoutMs),
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
   })
   if(!result?.ok||result.redirected===true)fail()
   raw=await result.text()
   if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_BYTES)fail()
   return JSON.parse(raw)
  }catch{fail()}
 }
 const listProjects=async()=>{
  const rows=await remote('GET','/rest/v1/friday_projects?select=id,name&limit=100')
  if(!Array.isArray(rows)||rows.length>100||rows.some(row=>!idName(row)))fail()
  return rows
 }
 const insertProjects=async rows=>{
  if(allowInsert!==true||!Array.isArray(rows)||rows.length<1||rows.length>4)fail()
  const seen=new Set()
  for(const row of rows){
   if(!idName(row)||seen.has(row.id)||!
      FOUR_PROJECT_CATALOG.some(p=>p.id===row.id&&p.name===row.name))fail()
   seen.add(row.id)
  }
  const response=await remote('POST','/rest/v1/friday_projects?select=id,name',rows)
  if(!Array.isArray(response)||response.length!==rows.length||
     response.some((row,i)=>!idName(row)||row.id!==rows[i].id||row.name!==rows[i].name))fail()
 }
 return Object.freeze({listProjects,insertProjects})
}
