import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
export const TABLES=['friday_projects','friday_work_items','friday_work_claims','friday_agent_runs','friday_checkpoints','friday_handoffs','friday_decisions','friday_artifacts','friday_memories']
export function validateSharedWorkSchema(sql){
 const clean=String(sql).replace(/--[^\n]*/g,'').toLowerCase()
 const errors=[]
 for(const name of TABLES){
  if(!new RegExp('create\\s+table\\s+public\\.'+name+'\\s*\\(').test(clean))errors.push(name+':missing')
  if(!clean.includes('alter table public.'+name+' enable row level security;'))errors.push(name+':rls')
  if(!clean.includes('revoke all on public.'+name+' from public, anon, authenticated;'))errors.push(name+':privilege')
 }
 for(const banned of [/\balter\s+table\s+public\.friday_agents\b/,/\bsecurity\s+definer\b/,/grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+public/,/scope\s*<>\s*'nonsense'/])if(banned.test(clean))errors.push('unsafe-schema')
 if(!clean.includes("scope <> 'session'"))errors.push('durable-session-scope')
 if(!clean.includes('to service_role;'))errors.push('service-grant')
 return {ok:errors.length===0,errors}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const r=validateSharedWorkSchema(readFileSync(process.argv[2],'utf8'));if(!r.ok){console.error(r.errors);process.exitCode=1}else console.log('PASS shared-work schema')}catch{process.exitCode=2}
}