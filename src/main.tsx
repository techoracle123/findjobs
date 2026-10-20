import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthPage } from './components/AuthPage'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found in the document.')
}

createRoot(container).render(
  <StrictMode>
    {/^\/auth\/(?:signup|login|recovery)\/?$/.test(window.location.pathname) ? (
      <AuthPage />
    ) : (
      <App />
    )}
  </StrictMode>,
)
