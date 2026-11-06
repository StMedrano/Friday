// HTTP transport for Friday's only work write: POST /api/work/tasks creates a
// 'ready' task. The bridge re-verifies the signed Access JWT, requires an
// operator email and a project grant, and talks to an insert-only role.
// Claiming, moving, editing or running a task is not exposed here.

const ROUTE='/api/work/tasks'
const PROJECT=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const STATUS=Object.freeze({
 invalid:[400,'invalid-work-task'],
 denied:[403,'work-write-denied'],
 conflict:[409,'work-task-request-reused'],
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
