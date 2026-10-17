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
await writeFile(file,JSON.stringify(Array.from({length:61},(_,i)=>({id:'00000000-0000-4000-8000-'+String(100-i).padStart(12,'0'),project_id:'project-pages',title:'Paged fixture '+i,objective:'Synthetic pagination record',acceptance_criteria:[],created_at:'2000-01-01T12:00:00.123456Z',status:'ready',version:1}))))
// Minimal PostgREST protocol fixture exercises the real repository adapter.
const repository=createSupabaseWorkRepository({baseUrl:'https://fixture.invalid',serviceKey:'synthetic-not-a-key',fetchImpl:async(url,options)=>{
 const path=new URL(url)
 if(path.pathname==='/rest/v1/friday_projects')return {ok:true,json:async()=>[{id:'project-a',name:'Synthetic local project'},{id:'project-pages',name:'Synthetic paged project'}]}
 const rows=JSON.parse(await readFile(file,'utf8'))
 if(options.method==='POST'){
  const body=JSON.parse(options.body)
  if(body.title==='Fail fixture write')return {ok:false,status:503}
  const prior=rows.find(row=>row.creator_principal===body.creator_principal&&row.request_id===body.request_id)
  if(prior)return {ok:true,json:async()=>[]}
  const row={...body,id:randomUUID(),created_at:new Date().toISOString().replace('Z','000Z'),status:'ready',version:1};rows.push(row);await writeFile(file,JSON.stringify(rows))
  if(body.title==='Lost response fixture')return {ok:false,status:503}
  return {ok:true,json:async()=>[row]}
 }
 let result=rows.filter(row=>path.searchParams.has('project_id')?row.project_id===path.searchParams.get('project_id').slice(3):row.request_id===path.searchParams.get('request_id')?.slice(3))
 if(path.searchParams.has('order')){
  result.sort((a,b)=>a.created_at===b.created_at?(a.id<b.id?1:a.id>b.id?-1:0):a.created_at<b.created_at?1:-1)
  const condition=path.searchParams.get('or')
  if(condition){const match=/^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.\1,id\.lt\.([0-9a-f-]+)\)\)$/.exec(condition);if(!match)throw Error('Unexpected synthetic page filter');result=result.filter(row=>row.created_at<match[1]||(row.created_at===match[1]&&row.id<match[2]))}
  result=result.slice(0,Number(path.searchParams.get('limit')))
 }
 return {ok:true,json:async()=>result}
}})
const config=getConfig({FRIDAY_MODE:'mock'})
config.mode='live';config.access={enabled:true,publicOrigin:'http://127.0.0.1:8772'}
const server=createFridayServer({config,verifyAccessImpl:async()=>({ok:true,email:'owner@example.test'}),buildOverviewImpl:async()=>({mode:'mock',generatedAt:new Date().toISOString(),sites:[],services:[],alerts:[],resources:[],activities:[],integrations:[],incidents:[]}),projectTasks:createProjectTaskAccess({repository,owner:{email:'owner@example.test',principalId:'synthetic-owner'}})})
server.listen(8772,'127.0.0.1',()=>console.log('Synthetic fixture only: http://127.0.0.1:8772'))
let closing=false
async function close(){if(closing)return;closing=true;await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true})}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{close().finally(()=>process.exit())})
