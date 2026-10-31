import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthPage } from './components/AuthPage'
import { HomePage } from './components/HomePage'
import { QualityWallboard } from './components/QualityWallboard'
import { InfoPage } from './components/InfoPage'
import { AdminCopy } from './components/AdminCopy'
import { PricingPage } from './components/PricingPage'
import { EmployersPage } from './components/EmployersPage'
import { AnalyticsWallboard } from './components/AnalyticsWallboard'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found in the document.')
}

createRoot(container).render(
  <StrictMode>
    {/^\/auth\/(?:signup|login|recovery|reset)\/?$/.test(window.location.pathname) ? (
      <AuthPage />
    ) : window.location.pathname === '/' ? (
      <HomePage />
    ) : window.location.pathname === '/admin/data-quality' ? (
      <QualityWallboard />
    ) : window.location.pathname === '/admin/copy' ? (
      <AdminCopy />
    ) : window.location.pathname === '/admin/analytics' ? (
      <AnalyticsWallboard />
    ) : window.location.pathname === '/pricing' ? (
      <PricingPage />
    ) : window.location.pathname === '/employers' ? (
      <EmployersPage />
    ) : /^\/(about|privacy|terms|faq|scams|contact)\/?$/.test(window.location.pathname) ? (
      <InfoPage path={window.location.pathname.replace(/\/+$/, '')} />
    ) : (
      <App />
    )}
  </StrictMode>,
)
