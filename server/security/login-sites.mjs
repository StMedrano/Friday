const REQUIRED_IDS=new Set(['family','techtactics'])
const LABELS=Object.freeze({
 family:Object.freeze({
  title:'Family HomeLab',
  eyebrow:'FAMILY NETWORK',
  subtitle:'Private access for your family and HomeLab applications.',
  prompt:'Continue securely to your family account',
  note:'HomeLab access is restricted to approved family accounts.',
 }),
 techtactics:Object.freeze({
  title:'TechTactics',
  eyebrow:'BUSINESS IDENTITY',
  subtitle:'Secure access for TechTactics clients, employees and services.',
  prompt:'Continue securely to your TechTactics account',
  note:'Business permissions are managed separately from family access.',
 }),
})
const BASE_HEADERS=Object.freeze({
 'cache-control':'no-store',
 'x-content-type-options':'nosniff',
 'x-frame-options':'DENY',
 'referrer-policy':'no-referrer',
 'content-security-policy':"default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'",
})
const CSS=`
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111b2b;color:#eef5ff;padding:28px}
main{width:min(100%,460px);background:#182435;border:1px solid #3a4c66;border-radius:20px;padding:38px;box-shadow:0 20px 60px #0005}
.family{--accent:#c4b5fd;--outline:#8b77c8}
.techtactics{--accent:#6ce0ee;--outline:#3fa0b0}
.symbol{width:52px;height:52px;border-radius:14px;border:1px solid var(--outline);color:var(--accent);display:grid;place-items:center;font-size:25px;font-weight:800;margin-bottom:26px}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:700;color:var(--accent)}
h1{margin:12px 0;font-size:clamp(27px,6vw,36px);letter-spacing:-.04em;line-height:1.15}
p{color:#b8c7de;line-height:1.65;font-size:15px}
.action{margin-top:28px;display:block;width:100%;border-radius:11px;padding:16px 18px;text-align:center;background:var(--accent);color:#0b1524;font-weight:800;text-decoration:none;font:inherit;font-weight:800;border:0;cursor:pointer}
.action:hover,.action:focus-visible{outline:3px solid #f0f7ff;outline-offset:3px;filter:brightness(1.08)}
.notice{border-top:1px solid #36445a;margin-top:30px;padding-top:17px;font-size:12px;color:#9aadc7}
.status{color:var(--accent);font-size:14px;font-weight:600}
footer{text-align:center;margin-top:22px;color:#8899af;font-size:12px}
@media(max-width:520px){body{padding:16px}main{padding:26px;border-radius:15px}}
`
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k))
const validOrigin=value=>{
 if(typeof value!=='string'||value.length>512)return false
 try{
  const parsed=new URL(value)
  return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&
   !parsed.port&&!parsed.search&&!parsed.hash&&parsed.pathname==='/'&&
   parsed.origin===value&&parsed.hostname.includes('.')&&
   !parsed.hostname.includes('*')&&!['localhost','local'].includes(parsed.hostname.split('.').at(-1))
 }catch{return false}
}
const escapeHTML=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
const headers=(extra={})=>({...BASE_HEADERS,...extra})
const response=(status,body='',extra={})=>({status,headers:headers(extra),body})
const fail=(status=403)=>response(status,'Access unavailable.',{
 'content-type':'text/plain; charset=utf-8',
})
const html=(site,body)=>`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHTML(site.brand.title)} · Secure Sign In</title>
<link rel="stylesheet" href="/auth/portal.css"></head>
<body class="${site.id}"><div><main aria-label="${escapeHTML(site.brand.title)} sign in">
<div class="symbol" aria-hidden="true">${site.id==='family'?'⌂':'T'}</div>
<div class="eyebrow">${escapeHTML(site.brand.eyebrow)}</div>
${body}
<div class="notice">${escapeHTML(site.brand.note)}</div></main>
<footer>Secure authentication powered by authentik</footer></div></body></html>`
const page=(site)=>html(site,`<h1>${escapeHTML(site.brand.title)}</h1>
<p>${escapeHTML(site.brand.subtitle)}</p>
<a class="action" href="/auth/start">${escapeHTML(site.brand.prompt)}</a>`)
const accountPage=(site,csrf)=>html(site,`<h1>${escapeHTML(site.brand.title)}</h1>
<p class="status">Signed in to this site.</p>
<p>Your access to this site does not grant permissions to other applications.</p>
<form action="/auth/logout" method="post">
<input type="hidden" name="csrfToken" value="${escapeHTML(csrf)}">
<button class="action" type="submit">Sign out of this site</button>
</form>`)
const noNewlines=value=>typeof value==='string'&&
 !/[\r\n\0]/.test(value)

/**
 * Exactly two independently branded, public sign-in entry sites. This pure
 * route adapter is opt-in and NOT registered in server/http.mjs or served in
 * production. The caller must supply server-owned TLS-validated origin,
 * request method/path, cookie, and strictly parsed callback/body fields.
 *
 * Distinct authentik IdP origins enable separate domain-based Brands, but
 * Brand configuration is NOT an authorization or tenant boundary. Each
 * injected browser must use a separate OIDC client and role/session policy.
 * Family web login never authorizes any HomeLab infrastructure action.
 */
export function createLoginSites({enabled=false,sites}={}) {
 let ready=enabled===true&&Array.isArray(sites)&&sites.length===2
 const byOrigin=new Map(),identities=new Set(),ids=new Set()
 if(ready) {
  for(const entry of sites){
   if(!exact(entry,['id','origin','identityOrigin','browser'])||
      !REQUIRED_IDS.has(entry.id)||ids.has(entry.id)||
      !validOrigin(entry.origin)||!validOrigin(entry.identityOrigin)||
      entry.origin===entry.identityOrigin||
      byOrigin.has(entry.origin)||identities.has(entry.identityOrigin)||
      !['begin','complete','current','logout'].every(k=>typeof entry.browser?.[k]==='function')){
    ready=false;break
   }
   const site={...entry,brand:LABELS[entry.id]}
   ids.add(entry.id);identities.add(entry.identityOrigin)
   byOrigin.set(entry.origin,Object.freeze(site))
  }
  if(ids.size!==2||identities.size!==2||byOrigin.size!==2)ready=false
 }
 return Object.freeze({
  enabled:ready,
  async handle(input) {
   if(!ready)return fail(503)
   if(!input||typeof input!=='object'||Array.isArray(input))return fail(400)
   const {method,origin,path}=input
   if(!validOrigin(origin)||!byOrigin.has(origin))return fail(404)
   const site=byOrigin.get(origin)
   if(typeof path!=='string'||!path.startsWith('/')||
      path.includes('..')||path.includes('//')||path.includes('?')||
      path.includes('#')||path.length>128)return fail(404)
   if(method!=='GET'&&method!=='POST')return fail(405)
   if(path==='/'&&method==='GET')return response(303,'',{location:'/login'})
   if(path==='/login'&&method==='GET')return response(200,page(site),{
    'content-type':'text/html; charset=utf-8',
   })
   if(path==='/auth/portal.css'&&method==='GET')return response(200,CSS,{
    'content-type':'text/css; charset=utf-8',
   })
   if(path==='/auth/start'){
    if(method!=='GET')return fail(405)
    try{
     const begin=await site.browser.begin({applicationId:site.id,origin:site.origin})
     const url=new URL(begin.authorizationUrl)
     if(begin.applicationId!==site.id||url.origin!==site.identityOrigin||
        url.pathname!=='/application/o/authorize/'||!noNewlines(begin.setCookie)||
        !begin.setCookie.startsWith(`__Host-friday-oidc-${site.id}=`))return fail()
     return response(302,'',{location:begin.authorizationUrl,'set-cookie':begin.setCookie})
    }catch{return fail()}
   }
   if(path==='/auth/oidc/callback'){
    if(method!=='GET')return fail(405)
    if(!exact(input.query,['state','code']))return fail(400)
    try{
     const result=await site.browser.complete({applicationId:site.id,origin:site.origin,
      state:input.query.state,code:input.query.code,cookieHeader:input.cookieHeader})
     if(result?.applicationId!==site.id||result.state!=='authenticated'||
        !Array.isArray(result.setCookies)||result.setCookies.length!==2||
        !result.setCookies.every(noNewlines)||
        !result.setCookies[0].startsWith(`__Host-friday-oidc-${site.id}=`)||
        !result.setCookies[1].startsWith(`__Host-friday-session-${site.id}=`))return fail()
     return response(303,'',{location:'/account','set-cookie':result.setCookies})
    }catch{return fail()}
   }
   if(path==='/account'){
    if(method!=='GET')return fail(405)
    try{
     const user=await site.browser.current({applicationId:site.id,origin:site.origin,
      cookieHeader:input.cookieHeader})
     if(user?.applicationId!==site.id||typeof user.csrfToken!=='string'||
        !/^[A-Za-z0-9_-]{43}$/.test(user.csrfToken))return fail()
     return response(200,accountPage(site,user.csrfToken),{
      'content-type':'text/html; charset=utf-8',
     })
    }catch{return fail()}
   }
   if(path==='/auth/logout'){
    if(method!=='POST')return fail(405)
    if(input.originHeader!==site.origin)return fail()
    try{
     const result=await site.browser.logout({applicationId:site.id,origin:site.origin,
      originHeader:input.originHeader,cookieHeader:input.cookieHeader,csrfToken:input.csrfToken})
     if(result?.applicationId!==site.id||result.state!=='signed-out'||
        !Array.isArray(result.setCookies)||result.setCookies.length!==2||
        !result.setCookies.every(noNewlines)||
        !result.setCookies[0].startsWith(`__Host-friday-oidc-${site.id}=`)||
        !result.setCookies[1].startsWith(`__Host-friday-session-${site.id}=`))return fail()
     return response(303,'',{location:'/login','set-cookie':result.setCookies})
    }catch{return fail()}
   }
   return fail(404)
  },
 })
}
