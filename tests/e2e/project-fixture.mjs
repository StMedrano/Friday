// Loopback-only disposable fixture. No env credentials or external integrations.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createFridayServer} from '../../server/http.mjs'
import {getConfig} from '../../server/config.mjs'
import {createProjectTaskAccess} from '../../server/work/project-access.mjs'
import {createSupabaseWorkRepository} from '../../server/work/supabase-repository.mjs'
const directory=await mkdtemp(join(tmpdir(),'friday-project-e2e-'))
const file=join(directory,'synthetic-records.json')
await writeFile(file,'[]')
// Minimal PostgREST protocol fixture exercises the real repository adapter.
const repository=createSupabaseWorkRepository({baseUrl:'https://fixture.invalid',serviceKey:'synthetic-not-a-key',fetchImpl:async(url,options)=>{
 const path=new URL(url)
 if(path.pathname==='/rest/v1/friday_projects')return {ok:true,json:async()=>[{id:'project-a',name:'Synthetic local project'}]}
 const rows=JSON.parse(await readFile(file,'utf8'))
 if(options.method==='POST'){
  const body=JSON.parse(options.body)
  if(body.title==='Fail fixture write')return {ok:false,status:503}
  const prior=rows.find(row=>row.creator_principal===body.creator_principal&&row.request_id===body.request_id)
  if(prior)return {ok:true,json:async()=>[]}
  const row={...body,id:randomUUID(),status:'ready',version:1};rows.push(row);await writeFile(file,JSON.stringify(rows));return {ok:true,json:async()=>[row]}
 }
 return {ok:true,json:async()=>rows.filter(row=>path.searchParams.has('project_id')?row.project_id===path.searchParams.get('project_id').slice(3):row.request_id===path.searchParams.get('request_id')?.slice(3))}
}})
const config=getConfig({FRIDAY_MODE:'mock'})
config.mode='live';config.access={enabled:true,publicOrigin:'http://127.0.0.1:8772'}
const server=createFridayServer({config,verifyAccessImpl:async()=>({ok:true,email:'owner@example.test'}),buildOverviewImpl:async()=>({mode:'mock',generatedAt:new Date().toISOString(),sites:[],services:[],alerts:[],resources:[],activities:[],integrations:[],incidents:[]}),projectTasks:createProjectTaskAccess({repository,owner:{email:'owner@example.test',principalId:'synthetic-owner'}})})
server.listen(8772,'127.0.0.1',()=>console.log('Synthetic fixture only: http://127.0.0.1:8772'))
let closing=false
async function close(){if(closing)return;closing=true;await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true})}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{close().finally(()=>process.exit())})
