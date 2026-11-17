import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerServiceWorker } from './pwa'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()

// After a new deploy, a tab opened on the previous version may ask for a page chunk that no
// longer exists. Reload once to pick up the new version instead of showing a broken page.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const last = Number(sessionStorage.getItem('naav-chunk-reload') || 0)
    if (Date.now() - last < 30000) return // already retried just now; let the error surface
    sessionStorage.setItem('naav-chunk-reload', String(Date.now()))
  } catch { /* storage blocked: still reload once */ }
  event.preventDefault()
  window.location.reload()
})
