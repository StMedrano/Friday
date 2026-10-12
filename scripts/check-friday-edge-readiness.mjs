import { pathToFileURL } from 'node:url'

export const routes=['/','/api/overview','/api/agents']
export async function checkAnonymousAccess({origin='https://friday.mytechtactics.com',fetchImpl=fetch}={}){
  const url=new URL(origin)
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.port){
    throw Error('Only a plain HTTPS origin is accepted')
  }
  const results=[]
  for(const path of routes){
    let status=null
    let loginRedirect=false
    try{
      const response=await fetchImpl(url.origin+path,{
        method:'GET',
        redirect:'manual',
        headers:{accept:'application/json','cache-control':'no-store'},
        signal:AbortSignal.timeout(8000),
      })
      status=response.status
      if(status>=300&&status<400){
        const rawLocation=response.headers.get('location')
        if(rawLocation){
          try{
            const target=new URL(rawLocation,url.origin)
            loginRedirect=target.protocol==='https:' && target.pathname.startsWith('/cdn-cgi/access/') && (
              target.hostname===url.hostname || target.hostname.endsWith('.cloudflareaccess.com'))
          }catch{}
        }
      }
      // Never read or print bodies, redirects, cookies or JWT headers.
      try{await response.body?.cancel()}catch{}
    }catch{
      results.push({path,status:null,closed:false,reason:'network-error'})
      continue
    }
    // A 404, generic redirect or 503 could mean a broken route or ingress;
    // it is NOT evidence that Cloudflare Access protects the real app.
    const closed=(status===401||status===403||loginRedirect)
    results.push({path,status,closed,reason:closed?'not-anonymous-success':'anonymous-response-unprotected'})
  }
  return {safe:results.every(x=>x.closed),results}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const origin=process.env.FRIDAY_EDGE_ORIGIN||'https://friday.mytechtactics.com'
 checkAnonymousAccess({origin}).then(({safe,results})=>{
   for(const r of results)process.stdout.write(r.path+' status='+String(r.status)+' '+(r.closed?'DENIED':'UNPROTECTED_OR_UNKNOWN')+'\n')
   process.stdout.write(safe?'PASS: no anonymous 2xx for protected routes\n':'BLOCKED: public access still exposed or not verifiable\n')
   if(!safe)process.exitCode=2
 }).catch(e=>{process.stderr.write('Access preflight failed: '+e.message+'\n');process.exitCode=2})
}
