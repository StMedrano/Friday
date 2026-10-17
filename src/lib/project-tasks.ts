export type Project={id:string;name:string}
export type ProjectTask={id:string;projectId:string;title:string;objective:string;acceptanceCriteria:string[];status:string;version:number}
const validId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)
const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max
export async function projectRequest(path:string,options:RequestInit={}){
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)
 const response=await fetch(path,{...options,signal,cache:'no-store'})
 if(!response.ok)throw Error(response.status===403?'Project access denied':response.status===400?'Check task fields':response.status===409?'Task request conflicts with an earlier save':'Task storage unavailable')
 return response.json()
}
export function projectsFrom(value:unknown):Project[]{
 const rows=(value as {projects?:unknown})?.projects
 if(!Array.isArray(rows)||rows.length>50||rows.some(x=>!x||!validId(x.id)||!text(x.name,160))||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Project response invalid')
 return rows.map(({id,name})=>({id,name}))
}
export function tasksFrom(value:unknown,projectId:string):ProjectTask[]{
 const rows=(value as {tasks?:unknown})?.tasks
 if(!Array.isArray(rows)||rows.length>50||rows.some(x=>!x||x.projectId!==projectId||!validId(x.id)||!text(x.title,160)||!text(x.objective,4000)||!Array.isArray(x.acceptanceCriteria)||x.acceptanceCriteria.length>50||x.acceptanceCriteria.some((v:unknown)=>typeof v!=='string'||v.length>500)||!['ready','in_progress','blocked','review','completed','cancelled'].includes(x.status)||!Number.isSafeInteger(x.version)||x.version<1)||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('Task response invalid')
 return rows
}
export function taskPageFrom(value:unknown,projectId:string):{tasks:ProjectTask[];nextCursor:string|null}{
 const cursor=(value as {nextCursor?:unknown})?.nextCursor
 if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>1024||!/^[A-Za-z0-9_-]+$/.test(cursor)))throw Error('Task page response invalid')
 return {tasks:tasksFrom(value,projectId),nextCursor:cursor}
}
