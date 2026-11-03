import { pathToFileURL } from 'node:url'

// GET-only probes: never submit a prompt, registry sync, diagnostic action or
// other mutation to an external server that could be misconfigured.
export const routes=[
 '/',
 '/index.html',
 '/api/overview',
 '/api/agents',
 '/api/assistant',
 '/healthz',
]

const TRUSTED_TEAM_HOST=/^[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/

export async function checkAnonymousAccess({
 origin='https://friday.mytechtactics.com',
 expectedTeamHost='mytechtactics.cloudflareaccess.com',
 fetchImpl=fetch,
}={}){
 const url=new URL(origin)
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.port)
  throw Error('Only a plain HTTPS origin is accepted')
 if(typeof expectedTeamHost!=='string'||!TRUSTED_TEAM_HOST.test(expectedTeamHost))
  throw Error('Expected Cloudflare Access team hostname is invalid')

 const results=[]
 for(const path of routes){
  let status=null
  let loginRedirect=false
  try{
   const response=await fetchImpl(url.origin+path,{
    method:'GET',redirect:'manual',
    headers:{accept:'application/json','cache-control':'no-store'},
    signal:AbortSignal.timeout(8000),
   })
   status=response.status
   if(status>=300&&status<400){
    const rawLocation=response.headers.get('location')
    if(rawLocation){
     try{
      const target=new URL(rawLocation,url.origin)
      loginRedirect=target.protocol==='https:'&&
       target.hostname===expectedTeamHost&&
       target.pathname.startsWith('/cdn-cgi/access/')
     }catch{}
    }
   }
   // Drop the body. Never read, print, save or follow cookies, redirects or JWTs.
   try{await response.body?.cancel()}catch{}
  }catch{
   results.push({path,status:null,closed:false,reason:'network-error'})
   continue
  }
  // This is a necessary, not sufficient, Access check. 401/403 alone do not
  // establish a valid logged-in session or prove the edge policy configuration.
  // Generic redirects, 404, 429, 503 and network errors are NOT a pass.
  const closed=(status===401||status===403||loginRedirect)
  results.push({path,status,closed,reason:closed?'anonymous-request-denied':'exposed-or-unverifiable'})
 }
 return {safe:results.every(x=>x.closed),results}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const origin=process.env.FRIDAY_EDGE_ORIGIN||'https://friday.mytechtactics.com'
 const expectedTeamHost=process.env.FRIDAY_EDGE_TEAM_HOST||'mytechtactics.cloudflareaccess.com'
 checkAnonymousAccess({origin,expectedTeamHost}).then(({safe,results})=>{
  for(const r of results)process.stdout.write(r.path+' status='+String(r.status)+' '+(r.closed?'DENIED':'UNPROTECTED_OR_UNKNOWN')+'\n')
  process.stdout.write(safe?'PASS: no anonymous access to tested routes; authenticated session not checked\n':'BLOCKED: exposed or unverifiable anonymous route\n')
  if(!safe)process.exitCode=2
 }).catch(e=>{process.stderr.write('Access preflight failed: '+e.message+'\n');process.exitCode=2})
}
