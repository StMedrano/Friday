import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import {registerFridayPwa} from './lib/pwa'
import './styles.css'
import './pwa.css'
import './diagnostics-polish.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Register only in production and after the app is already usable.
if(import.meta.env.PROD){
  window.addEventListener('load',()=>{void registerFridayPwa()},{once:true})
}
