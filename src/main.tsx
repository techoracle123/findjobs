import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthPage } from './components/AuthPage'
import { QualityWallboard } from './components/QualityWallboard'
import { InfoPage } from './components/InfoPage'
import { AdminCopy } from './components/AdminCopy'
import { PricingPage } from './components/PricingPage'
import { AnalyticsWallboard } from './components/AnalyticsWallboard'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found in the document.')
}

createRoot(container).render(
  <StrictMode>
    {/^\/auth\/(?:signup|login|recovery)\/?$/.test(window.location.pathname) ? (
      <AuthPage />
    ) : window.location.pathname === '/admin/data-quality' ? (
      <QualityWallboard />
    ) : window.location.pathname === '/admin/copy' ? (
      <AdminCopy />
    ) : window.location.pathname === '/admin/analytics' ? (
      <AnalyticsWallboard />
    ) : window.location.pathname === '/pricing' ? (
      <PricingPage />
    ) : /^\/(about|privacy|terms|faq|scams|contact|employers)\/?$/.test(
        window.location.pathname,
      ) ? (
      <InfoPage path={window.location.pathname.replace(/\/+$/, '')} />
    ) : (
      <App />
    )}
  </StrictMode>,
)
