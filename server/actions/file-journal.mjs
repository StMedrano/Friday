import {constants} from 'node:fs'
import {open, stat, lstat} from 'node:fs/promises'
import {dirname, isAbsolute} from 'node:path'

const safeReason=()=>new Error('audit-unavailable')
// Mandatory durable append-only audit writer. No symlink follows at the file
// boundary; parent directory must already exist and be private. Single process
// only; do not use on replicated deployments without a transactional store.
export function createFileActionJournal({path,uid=process.getuid?.()}={}){
 if(typeof path!=='string'||!isAbsolute(path)||path.endsWith('/'))throw safeReason()
 let queue=Promise.resolve()
 async function append(event){
  const task=queue.then(async()=>{
   let fd
   try{
    const parent=await lstat(dirname(path))
    if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0||
      (uid!==undefined&&parent.uid!==uid))throw safeReason()
    fd=await open(path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600)
    const meta=await fd.stat()
    if(!meta.isFile()||(meta.mode&0o077)!==0||(uid!==undefined&&meta.uid!==uid))throw safeReason()
    // Only the four fixed fields below; never serialize model text, command,
    // service credentials, arbitrary request body, or provider responses.
    const allowed=['event','requestId','actionId','target','actor']
    const line=JSON.stringify(Object.fromEntries(allowed.map(k=>[k,event[k]])))+'\n'
    const buffer=Buffer.from(line,'utf8')
    if(buffer.length>2048)throw safeReason()
    let n=0
    while(n<buffer.length){
     const part=await fd.write(buffer,n,buffer.length-n)
     if(part.bytesWritten<=0)throw safeReason()
     n+=part.bytesWritten
    }
    await fd.sync()
   }catch{throw safeReason()}
   finally{await fd?.close().catch(()=>{})}
  })
  queue=task.catch(()=>{})
  return task
 }
 return Object.freeze({append})
}
