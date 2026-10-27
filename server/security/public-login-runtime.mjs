import {createPostgresOidcTransactions} from './postgres-oidc-transactions.mjs'
import {createPostgresLoginSessions} from './postgres-login-sessions.mjs'
import {createPublicOidcFlow} from './public-oidc.mjs'
import {createPublicOidcBrowser} from './public-oidc-browser.mjs'
import {createLoginSites} from './login-sites.mjs'
import {createLoginSiteHttpHandler} from './login-sites-http.mjs'

const IDS=['family','techtactics']
const FIELDS=['id','publicOrigin','identityOrigin','clientId','clientSecret',
 'signingKey','transactionKey','query']
const unavailable=Object.freeze({enabled:false,handlerFor:()=>null})
const exact=(value,keys)=>value!==null&&typeof value==='object'&&
 !Array.isArray(value)&&Object.keys(value).length===keys.length&&
 keys.every(key=>Object.hasOwn(value,key))
const privateKey=value=>Buffer.isBuffer(value)&&value.length===32
const distinct=(a,b)=>!a.equals(b)

/**
 * Default-off, source-only assembly for the TWO public Authentik web sites.
 *
 * Every website gets an independent OIDC issuer/client, a separate
 * PostgreSQL query connection, atomic encrypted transaction store, session
 * store, cookie signing key and explicitly pinned HTTP handler. Neither the
 * public site nor its web session confers Friday/HomeLab execution rights.
 *
 * The operator must supply two DIFFERENT restricted database login roles
 * behind the query functions, private secrets, trusted TLS vhost routing,
 * real Authentik applications and an approved release plan. Function
 * reference separation alone cannot attest PostgreSQL role privileges.
 *
 * This assembly deliberately creates NO HTTP listener, route registration,
 * DB client, DNS record or external infrastructure side effect. It is NOT
 * imported by the running Friday server or automation API.
 */
export function createPublicLoginRuntime({
 enabled=false,sites,fetchImpl=fetch,now=Date.now,
}={}) {
 if(enabled!==true||!Array.isArray(sites)||sites.length!==2||
    typeof fetchImpl!=='function'||typeof now!=='function')return unavailable

 const byId=new Map()
 for(const site of sites) {
  if(!exact(site,FIELDS)||!IDS.includes(site.id)||byId.has(site.id)||
     !privateKey(site.signingKey)||!privateKey(site.transactionKey)||
     !distinct(site.signingKey,site.transactionKey)||
     typeof site.query!=='function'||typeof site.clientId!=='string'||
     typeof site.clientSecret!=='string')return unavailable
  byId.set(site.id,site)
 }
 if(byId.size!==2)return unavailable
 const family=byId.get('family'),business=byId.get('techtactics')
 if(family.query===business.query||
    family.publicOrigin===business.publicOrigin||
    family.identityOrigin===business.identityOrigin||
    family.clientId===business.clientId||
    family.clientSecret===business.clientSecret||
    ![family.signingKey,family.transactionKey].every(key=>
      distinct(key,business.signingKey)&&distinct(key,business.transactionKey)))
  return unavailable

 const entries=[]
 for(const id of IDS) {
  const site=byId.get(id)
  // Copy keys so later mutations of the owner's config Buffers cannot
  // silently alter the running site's browser-signing or state keys.
  const transactions=createPostgresOidcTransactions({
   enabled:true,applicationId:id,key:Buffer.from(site.transactionKey),
   query:site.query,now,
  })
  const sessions=createPostgresLoginSessions({
   enabled:true,applicationId:id,query:site.query,now,
  })
  if(!transactions.enabled||!sessions.enabled)return unavailable
  const flow=createPublicOidcFlow({
   enabled:true,identityOrigin:site.identityOrigin,
   applications:[{id,slug:id,clientId:site.clientId,
    clientSecret:site.clientSecret,
    redirectUri:site.publicOrigin+'/auth/oidc/callback'}],
  },{transactions,fetchImpl,now})
  if(!flow.enabled)return unavailable
  const browser=createPublicOidcBrowser({
   enabled:true,applications:[{id,origin:site.publicOrigin}],
   flow,sessionStore:sessions,signingKey:Buffer.from(site.signingKey),now,
  })
  if(!browser.enabled)return unavailable
  entries.push({id,origin:site.publicOrigin,
   identityOrigin:site.identityOrigin,browser})
 }
 const loginSites=createLoginSites({enabled:true,sites:entries})
 if(!loginSites.enabled)return unavailable
 const handlers=new Map(IDS.map(id=>[id,createLoginSiteHttpHandler({
  enabled:true,applicationId:id,
  publicOrigin:byId.get(id).publicOrigin,sites:loginSites,
 })]))
 return Object.freeze({
  enabled:true,
  // Site choice is permitted only at trusted server bootstrap. Never
  // route a browser-selected Host, cookie, OAuth claim or user role here.
  handlerFor(applicationId){return handlers.get(applicationId)||null},
 })
}
