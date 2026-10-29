/* Friday PWA: cache only immutable public Vite bundles, never operator data.
 * Cloudflare Access pages, OAuth, cookies, tasks, memory, monitoring and every
 * /api/* request always go to the network. No offline impersonation of a
 * successful API response. Version bump clears only Friday-owned caches.
 */
const STATIC_CACHE='friday-immutable-v1'
const ASSET=/^\/assets\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_-]{8,}\.(?:js|css)$/
const SENSITIVE=/^\/(?:api(?:\/|$)|cdn-cgi(?:\/|$)|auth(?:\/|$)|oauth(?:\/|$)|login(?:\/|$)|logout(?:\/|$)|callback(?:\/|$))/

const offlineHtml=`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#080a0f">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Friday · Offline</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#080a0f;color:#e5f4fb}
body{min-height:100dvh;display:grid;place-items:center;margin:0;padding:24px;box-sizing:border-box}
main{width:min(100%,430px);border:1px solid #233748;border-radius:20px;background:#101821;padding:32px}
.logo{font-weight:800;color:#73dcfb;font-size:20px;letter-spacing:.16em}
h1{font-size:1.7rem;margin:22px 0 10px}p{color:#a8bbc7;line-height:1.6}
a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#176783;color:white;text-decoration:none;font-weight:600}
a:focus-visible{outline:3px solid #73dcfb;outline-offset:3px}
</style></head><body><main><div class="logo">FRIDAY</div>
<h1>You are offline</h1>
<p>Friday needs a secure connection to verify access and display live information. No cached monitoring, Tasks, Memory, credentials or server controls are available offline.</p>
<a href="/">Try connecting again</a></main></body></html>`

self.addEventListener('install',event=>{
 // Do not precache the app document, which may be an Access login redirect.
 event.waitUntil(Promise.resolve())
})

self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys()
  await Promise.all(keys.filter(k=>k.startsWith('friday-immutable-v')&&k!==STATIC_CACHE)
   .map(k=>caches.delete(k)))
  await self.clients.claim()
 })())
})

self.addEventListener('fetch',event=>{
 const request=event.request
 if(request.method!=='GET')return
 const url=new URL(request.url)
 if(url.origin!==self.location.origin||SENSITIVE.test(url.pathname))return

 if(request.mode==='navigate'){
  // Always hit Access / the Friday origin again for navigation. Not even
  // successful authorized HTML may persist to offline storage.
  event.respondWith(fetch(request).catch(()=>new Response(offlineHtml,{
   status:503,statusText:'Offline',headers:{
    'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
   },
  })))
  return
 }

 if(!ASSET.test(url.pathname)||url.search||request.headers.has('authorization'))return

 event.respondWith((async()=>{
  let cache
  try{
   cache=await caches.open(STATIC_CACHE)
   const cached=await cache.match(request)
   if(cached)return cached
  }catch{
   // Cache Storage is an optional optimization. Keep online assets usable
   // when storage is unavailable, denied or temporarily inconsistent.
  }
  const response=await fetch(request)
  const contentType=response.headers.get('content-type')||''
  const expected=url.pathname.endsWith('.js')?
   /^(?:application|text)\/javascript(?:\s*;|\s*$)/i:
   /^text\/css(?:\s*;|\s*$)/i
  if(response.ok&&response.type!=='opaqueredirect'&&!response.redirected&&
   !response.headers.has('set-cookie')&&expected.test(contentType)){
   try{
    cache??=await caches.open(STATIC_CACHE)
    await cache.put(request,response.clone())
   }catch{
    // Never discard a valid network response because optional caching failed.
   }
  }
  return response
 })())
})
