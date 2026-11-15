// HTTP transport for Friday's work writes: POST /api/work/tasks creates a
// 'ready' task, POST /api/work/tasks/:id/move claims, releases or moves one,
// and POST /api/work/tasks/:id/edit changes its title (and objective). The
// bridge re-verifies the signed Access JWT, requires an operator email and a
// project grant, and talks to the friday_work_writer role. Deleting or
// running a task is not exposed here.

const ROUTE='/api/work/tasks'
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MOVE_ROUTE=/^\/api\/work\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/move$/i
const EDIT_ROUTE=/^\/api\/work\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/edit$/i
const STATUS=Object.freeze({
 invalid:[400,'invalid-work-task'],
 denied:[403,'work-write-denied'],
 conflict:[409,'work-task-request-reused'],
 moveConflict:[409,'work-task-changed'],
 moveInvalid:[400,'invalid-work-task-move'],
 editInvalid:[400,'invalid-work-task-edit'],
 editClosed:[409,'work-task-closed'],
 disabled:[404,'not-found'],
 unavailable:[503,'work-write-unavailable'],
})

/** True for the task-create route; the caller makes it operator-only and JSON-only. */
export function isWorkTaskCreate(method,pathname){
 return method==='POST'&&pathname===ROUTE
}

/** Project id for the audit record, or null when the body does not carry a valid one. */
export function workTaskAuditTarget(body){
 return typeof body?.projectId==='string'&&PROJECT.test(body.projectId)?body.projectId:null
}

export async function createWorkTask({request,url,body,bridge}={}){
 if(!bridge?.canCreateTasks||typeof bridge.createTask!=='function'){
  const [status,error]=STATUS.disabled
  return {status,body:{error}}
 }
 if(url?.searchParams?.size!==0||body===null||typeof body!=='object'||Array.isArray(body)){
  const [status,error]=STATUS.invalid
  return {status,body:{error}}
 }
 try{
  const task=await bridge.createTask(request,body)
  return {status:201,body:{task}}
 }catch(reason){
  const [status,error]=STATUS[reason?.code]||STATUS.unavailable
  return {status,body:{error}}
 }
}

/** Task id for a move route, or null; the caller makes it operator-only and JSON-only. */
export function workTaskMoveId(method,pathname){
 if(method!=='POST'||typeof pathname!=='string')return null
 return MOVE_ROUTE.exec(pathname)?.[1]?.toLowerCase()||null
}

export async function moveWorkTask({request,url,taskId,body,bridge}={}){
 if(!bridge?.canMoveTasks||typeof bridge.moveTask!=='function'){
  const [status,error]=STATUS.disabled
  return {status,body:{error}}
 }
 if(url?.searchParams?.size!==0||!taskId||body===null||typeof body!=='object'||Array.isArray(body)){
  const [status,error]=STATUS.moveInvalid
  return {status,body:{error}}
 }
 try{
  const task=await bridge.moveTask(request,{...body,workItemId:taskId})
  return {status:200,body:{task}}
 }catch(reason){
  const key=reason?.code==='conflict'?'moveConflict':reason?.code==='invalid'?'moveInvalid':reason?.code
  const [status,error]=STATUS[key]||STATUS.unavailable
  return {status,body:{error}}
 }
}

/** Task id for an edit route, or null; the caller makes it operator-only and JSON-only. */
export function workTaskEditId(method,pathname){
 if(method!=='POST'||typeof pathname!=='string')return null
 return EDIT_ROUTE.exec(pathname)?.[1]?.toLowerCase()||null
}

export async function editWorkTask({request,url,taskId,body,bridge}={}){
 if(!bridge?.canEditTasks||typeof bridge.editTask!=='function'){
  const [status,error]=STATUS.disabled
  return {status,body:{error}}
 }
 if(url?.searchParams?.size!==0||!taskId||body===null||typeof body!=='object'||Array.isArray(body)){
  const [status,error]=STATUS.editInvalid
  return {status,body:{error}}
 }
 try{
  const task=await bridge.editTask(request,{...body,workItemId:taskId})
  return {status:200,body:{task}}
 }catch(reason){
  const key={conflict:'moveConflict',invalid:'editInvalid',closed:'editClosed'}[reason?.code]||reason?.code
  const [status,error]=STATUS[key]||STATUS.unavailable
  return {status,body:{error}}
 }
}
