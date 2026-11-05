import { Fragment, useEffect, useState } from 'react'

type SiteHeaderPage = 'home' | 'jobs' | 'ideas' | 'pricing' | 'about' | 'dashboard'

interface SiteHeaderProps {
  current?: SiteHeaderPage
  signedIn?: boolean
}

/**
 * The public site header. It stays at the top of the public pages so people
 * can always get home, to jobs, to pricing, to account pages and to sign in.
 */
export function SiteHeader({ current, signedIn: signedInProp }: SiteHeaderProps) {
  const [signedIn, setSignedIn] = useState(Boolean(signedInProp))

  useEffect(() => {
    if (signedInProp !== undefined) {
      setSignedIn(signedInProp)
      return
    }
    let active = true
    void fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ user?: unknown }>) : null))
      .then((body: { user?: unknown } | null) => {
        if (active) setSignedIn(Boolean(body?.user))
      })
      .catch(() => {
        if (active) setSignedIn(false)
      })
    return () => {
      active = false
    }
  }, [signedInProp])

  return (
    <header className="topbar site-header">
      <a className="brand" href="/" aria-label="FJ Find Jobs home">
        <img className="brand__logo" src="/favicon.svg" alt="" width="36" height="36" />
        <span className="brand__word">
          <strong>FJ</strong> Find Jobs
        </span>
      </a>

      <nav className="topnav" aria-label="Primary">
        <a href="/" aria-current={current === 'home' ? 'page' : undefined}>
          Home
        </a>
        <a href="/jobs" aria-current={current === 'jobs' ? 'page' : undefined}>
          Jobs
        </a>
        <a href="/ideas" aria-current={current === 'ideas' ? 'page' : undefined}>
          Ideas
        </a>
        <a href="/pricing" aria-current={current === 'pricing' ? 'page' : undefined}>
          Pricing
        </a>
        <a href="/about" aria-current={current === 'about' ? 'page' : undefined}>
          About
        </a>
        {signedIn ? (
          <a href="/dashboard" aria-current={current === 'dashboard' ? 'page' : undefined}>
            Dashboard
          </a>
        ) : null}
      </nav>

      <div className="topbar__spacer" />
      <div className="topbar__actions">
        {signedIn ? (
          <a key="signed-in" className="btn btn--primary btn--sm" href="/jobs">
            See jobs
          </a>
        ) : (
          <Fragment key="anonymous">
            <a className="btn btn--ghost btn--sm" href="/auth/login?returnTo=%2Fjobs">
              Sign in
            </a>
            <a className="btn btn--primary btn--sm nav-signup" href="/auth/signup?returnTo=%2Fjobs">
              Sign up
            </a>
          </Fragment>
        )}
      </div>
    </header>
  )
}
