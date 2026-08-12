import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import App from './App'
import './styles.css'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const key = 'emisell_chunk_reload'
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1')
    window.location.reload()
  } else {
    sessionStorage.removeItem(key)
  }
})

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
