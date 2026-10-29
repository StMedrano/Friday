import {safeWorkError} from './validation.mjs'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function timestamp(value){
 const match=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value)
 if(!match||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,19)!==match[1])throw Error()
 return match[1]+'.'+(match[2]||'').padEnd(6,'0')+'Z'
}
function boundary(row){if(!row||typeof row.id!=='string'||!uuid.test(row.id))throw Error();return {id:row.id,createdAt:timestamp(row.createdAt)}}
const key=row=>row.createdAt+'|'+row.id
export function validateTaskAfter(value){
 if(value===undefined||value===null)return null
 try{if(Object.keys(value).sort().join(',')!=='createdAt,id')throw Error();return boundary(value)}catch{throw safeWorkError('invalid-input')}
}
export function parseTaskCursor(cursor,projectId){
 if(cursor===undefined)return null
 try{
  if(typeof cursor!=='string'||cursor.length>1024||!cursor||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error()
  const bytes=Buffer.from(cursor,'base64url');if(bytes.toString('base64url')!==cursor)throw Error()
  const value=JSON.parse(bytes.toString('utf8'))
  if(!value||Object.keys(value).sort().join(',')!=='createdAt,id,projectId'||value.projectId!==projectId)throw Error()
  return boundary(value)
 }catch{throw safeWorkError('invalid-input')}
}
export function encodeTaskCursor(projectId,row){
 try{return Buffer.from(JSON.stringify({projectId,...boundary(row)})).toString('base64url')}catch{throw safeWorkError('storage-unavailable')}
}
export function validateTaskPage(rows,after){
 try{
  if(!Array.isArray(rows)||rows.length>51)throw Error()
  let prior=after?key(boundary(after)):null;const ids=new Set()
  for(const row of rows){const current=key(boundary(row));if(ids.has(row.id)||(prior!==null&&current>=prior))throw Error();ids.add(row.id);prior=current}
  return rows
 }catch{throw safeWorkError('storage-unavailable')}
}
