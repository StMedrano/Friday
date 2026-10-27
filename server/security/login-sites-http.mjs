const HOST_IDS=new Set(['family','techtactics'])
const SAFE_HEADERS=new Set(['content-type','cache-control','x-content-type-options',
 'x-frame-options','referrer-policy','content-security-policy','location','set-cookie'])
const LIMIT=1024
const noStore=Object.freeze({
 'cache-control':'no-store',
 'x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
})
const denied=(response,status=403)=>{
 response.writeHead(status,{...noStore,'content-type':'text/plain; charset=utf-8'})
 response.end(status===503?'Login site unavailable.':'Request denied.')
}
const validate=(id,origin,sites)=>HOST_IDS.has(id)&&
 typeof origin==='string'&&origin.startsWith('https://')&&
 sites?.enabled===true&&typeof sites?.originFor==='function'&&
 sites.originFor(id)===origin&&typeof sites?.handle==='function'

function rawHost(request){
 // Never turn untrusted Host / X-Forwarded-* into the identity selector.
 // Each separate HTTP listener is pinned at construction time to ONE site.
 const raw=request.rawHeaders||[]
 if(raw.filter((name,i)=>i%2===0&&name.toLowerCase()==='host').length!==1)return null
 if(raw.some((name,i)=>i%2===0&&
    (/^x-forwarded-/i.test(name)||/^forwarded$/i.test(name)||
     /^x-friday-role$/i.test(name))))return null
 return request.headers.host
}
function queryParams(url){
 const items=[...url.searchParams.entries()]
 if(items.length!==2||items[0][0]===items[1][0]||
    !url.searchParams.has('state')||!url.searchParams.has('code'))return null
 const state=url.searchParams.get('state'),code=url.searchParams.get('code')
 if(typeof state!=='string'||!/^[A-Za-z0-9_-]{1,2048}$/.test(state)||
    typeof code!=='string'||!/^[\x21-\x7e]{1,2048}$/.test(code))return null
 return {state,code}
}
async function readLogout(request){
 const length=request.headers['content-length']
 if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>LIMIT))
  return {status:413}
 if(typeof request.headers['transfer-encoding']==='string'||
    typeof request.headers['content-type']!=='string'||
    !/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i
      .test(request.headers['content-type']))return {status:415}
 let bytes=0,buf=''
 try{
  for await(const chunk of request){
   bytes+=chunk.length
   if(bytes>LIMIT){request.resume();return {status:413}}
   buf+=chunk.toString('utf8')
  }
 }catch{return {status:400}}
 if(!buf||buf.includes(';')||/%(?![0-9a-f]{2})/i.test(buf))return {status:400}
 const form=new URLSearchParams(buf)
 const entries=[...form.entries()]
 if(entries.length!==1||entries[0][0]!=='csrfToken'||
    !/^[A-Za-z0-9_-]{43}$/.test(entries[0][1]))return {status:400}
 return {csrfToken:entries[0][1]}
}

/**
 * Server-only request adapter for TWO independent public login sites.
 * Not registered with the Friday production HTTP listener.
 *
 * Instantiate ONE pinned adapter per HTTPS vhost/loopback listener. An
 * external TLS ingress must preserve the exact registered Host header,
 * pin the vhost to the correct backend, and strip untrusted Forwarded*
 * headers. Do not treat Host or forwarded headers as tenant selectors.
 *
 * Does NOT call .listen(), provision DNS or create any session store.
 */
export function createLoginSiteHttpHandler({
 enabled=false,applicationId,publicOrigin,sites,
}={}){
 const configured=enabled===true&&validate(applicationId,publicOrigin,sites)
 const expectedHost=configured?new URL(publicOrigin).host:null
 return async function loginSiteHttp(request,response){
  if(!configured)return denied(response,503)
  if(rawHost(request)!==expectedHost)return denied(response,421)
  // Fail closed on Host override and smuggled raw URL paths. Never use
  // request URL/Host to derive the origin sent to the identity gateway.
  const rawUrl=request.url
  if(typeof rawUrl!=='string'||rawUrl.length>4096||
     !rawUrl.startsWith('/')||rawUrl.startsWith('//')||
     rawUrl.includes('\\')||rawUrl.includes('#'))return denied(response,404)
  const rawPath=rawUrl.split('?')[0]
  if(/%(?:2e|2f|5c)/i.test(rawPath)||rawPath.includes('..')||
     rawPath.includes('//')||rawPath.includes('%'))return denied(response,404)
  let url
  try{url=new URL(rawUrl,publicOrigin)}catch{return denied(response,400)}
  if(url.origin!==publicOrigin||url.pathname!==rawPath)return denied(response,404)
  if(request.method!=='GET'&&request.method!=='POST')return denied(response,405)
  const allowed=new Set(['/','/login','/auth/start','/auth/oidc/callback',
   '/auth/portal.css','/account','/auth/logout'])
  if(!allowed.has(url.pathname))return denied(response,404)
  if(url.pathname!=='/auth/oidc/callback'&&url.search!=='')return denied(response,400)
  if(url.pathname==='/auth/oidc/callback'&&request.method!=='GET')
   return denied(response,405)
  if(url.pathname==='/auth/logout'&&request.method!=='POST')
   return denied(response,405)
  if(url.pathname!=='/auth/logout'&&request.method!=='GET')
   return denied(response,405)
  const input={origin:publicOrigin,method:request.method,path:url.pathname}
  if(typeof request.headers.cookie==='string')input.cookieHeader=request.headers.cookie
  if(url.pathname==='/auth/oidc/callback'){
   const params=queryParams(url)
   if(!params)return denied(response,400)
   input.query=params
  }
  if(url.pathname==='/auth/logout'){
   if(request.headers.origin!==publicOrigin)return denied(response,403)
   const body=await readLogout(request)
   if(body.status)return denied(response,body.status)
   input.originHeader=request.headers.origin
   input.csrfToken=body.csrfToken
  }
  let result
  try{result=await sites.handle(input)}catch{return denied(response,503)}
  if(!result||![200,302,303,400,403,404,405,503].includes(result.status)||
     !result.headers||typeof result.headers!=='object'||
     typeof result.body!=='string')return denied(response,503)
  const headers={...noStore}
  for(const [key,value] of Object.entries(result.headers)){
   const name=key.toLowerCase()
   if(!SAFE_HEADERS.has(name))return denied(response,503)
   if(name==='set-cookie'){
    if(!((Array.isArray(value)&&value.length===2)||typeof value==='string'))
     return denied(response,503)
    const items=Array.isArray(value)?value:[value]
    if(items.some(x=>typeof x!=='string'||/[\r\n\0]/.test(x)))return denied(response,503)
    headers[name]=items
   }else{
    if(typeof value!=='string'||/[\r\n\0]/.test(value))return denied(response,503)
    headers[name]=value
   }
  }
  // A redirect Location is either a relative same-site path or the
  // configured exact IdP URL already validated by the site adapter.
  if(result.status===302||result.status===303){
   if(!headers.location)return denied(response,503)
   if(result.status===303&& !['/login','/account'].includes(headers.location))
    return denied(response,503)
   if(result.status===302&&url.pathname!=='/auth/start')return denied(response,503)
  }
  response.writeHead(result.status,headers)
  response.end(result.body)
 }
}
