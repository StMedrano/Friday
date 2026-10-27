/**
 * Optional PWA enhancement: no production auth or API capability is changed.
 * Service worker registration is done after window load, on HTTPS only.
 * The service worker itself never caches private responses or login pages.
 */
export async function registerFridayPwa({production=import.meta.env.PROD}:{
 production?:boolean
}={}):Promise<boolean>{
 if(!production||typeof window==='undefined'||typeof navigator==='undefined'||
   !window.isSecureContext||!('serviceWorker' in navigator))return false
 try{
  await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'})
  return true
 }catch{
  // The ordinary secure browser app continues to work without PWA support.
  return false
 }
}
