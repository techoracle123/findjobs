/**
 * Entry point for the jsdom smoke test. It mounts the real application so the
 * test exercises the same components the browser does.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found in the document.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
