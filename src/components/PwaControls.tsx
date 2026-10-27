import {useEffect,useState} from 'react'
import {Download} from 'lucide-react'

type InstallPrompt=Event&{
 prompt:()=>Promise<void>
 userChoice:Promise<{outcome:string}>
}

function standalone(){
 return Boolean(window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator&{standalone?:boolean}).standalone)
}

export default function PwaControls(){
 const [deferred,setDeferred]=useState<InstallPrompt|null>(null)
 const [installed,setInstalled]=useState(false)
 const [online,setOnline]=useState(true)

 useEffect(()=>{
  setInstalled(standalone())
  setOnline(navigator.onLine!==false)
  const beforeInstall=(event:Event)=>{
   if(standalone())return
   const offer=event as InstallPrompt
   if(typeof offer.prompt!=='function')return
   event.preventDefault()
   setDeferred(offer)
  }
  const onInstalled=()=>{setInstalled(true);setDeferred(null)}
  const syncOnline=()=>setOnline(navigator.onLine!==false)
  window.addEventListener('beforeinstallprompt',beforeInstall)
  window.addEventListener('appinstalled',onInstalled)
  window.addEventListener('online',syncOnline)
  window.addEventListener('offline',syncOnline)
  return ()=>{
   window.removeEventListener('beforeinstallprompt',beforeInstall)
   window.removeEventListener('appinstalled',onInstalled)
   window.removeEventListener('online',syncOnline)
   window.removeEventListener('offline',syncOnline)
  }
 },[])

 async function install(){
  if(!deferred)return
  const offer=deferred
  setDeferred(null)
  try{
   await offer.prompt()
   // Browser owns the choice. Do not claim installation until appinstalled.
   await offer.userChoice
  }catch{
   // No deceptive success feedback or retry loops for rejected prompts.
  }
 }

 return <>
  {!online&&<span className="friday-pwa-offline" role="status">Offline · reconnect for live data</span>}
  {!installed&&deferred&&<button className="friday-pwa-install" type="button"
   aria-label="Install FRIDAY" onClick={()=>{void install()}}>
   <Download size={14} aria-hidden="true"/>
   <span>Install app</span>
  </button>}
 </>
}
