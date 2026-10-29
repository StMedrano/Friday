import {useEffect,useRef} from 'react'
const modalStack:object[]=[]

// The opener is captured before React autofocus moves into the dialog.
export function useModalFocus(open:boolean,layoutKey:boolean,onDismiss:()=>void){
 const dialogRef=useRef<HTMLElement>(null)
 const openerRef=useRef<HTMLElement|null>(null)
 const identity=useRef({})
 const dismissRef=useRef(onDismiss)
 dismissRef.current=onDismiss
 const rememberFocus=()=>{openerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null}
 useEffect(()=>{
  if(!open)return
  const id=identity.current
  modalStack.push(id)
  const top=()=>modalStack.at(-1)===id
  const focusables=()=>Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input,button,a[href],select,textarea,[tabindex]')||[])
   .filter(element=>!element.hasAttribute('disabled')&&element.tabIndex>=0&&!element.closest('[hidden],[inert]'))
  const contain=(event:FocusEvent)=>{
   if(!top())return
   if(!dialogRef.current?.contains(event.target as Node))focusables()[0]?.focus()
  }
  const onKeyDown=(event:KeyboardEvent)=>{
   if(!top())return
   if(event.key==='Escape'){
    event.preventDefault();event.stopPropagation();dismissRef.current();return
   }
   if(event.key!=='Tab')return
   const elements=focusables(),first=elements[0],last=elements.at(-1)
   if(!first)return
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  document.addEventListener('focusin',contain)
  document.addEventListener('keydown',onKeyDown)
  focusables()[0]?.focus()
  return ()=>{
   const wasTop=top()
   const index=modalStack.indexOf(id)
   if(index>=0)modalStack.splice(index,1)
   document.removeEventListener('focusin',contain)
   document.removeEventListener('keydown',onKeyDown)
   if(wasTop&&openerRef.current?.isConnected)openerRef.current.focus()
  }
 },[open,layoutKey])
 return {dialogRef,rememberFocus}
}
