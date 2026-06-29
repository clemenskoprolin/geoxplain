import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { parseLaunchStateFromSearch } from '@/lib/launchState'
import { applyTheme } from '@/lib/theme'

const launchTheme = parseLaunchStateFromSearch(window.location.search)?.theme
if (launchTheme) {
  applyTheme(launchTheme)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
