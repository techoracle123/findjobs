import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mail, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'
import { copy } from '../shared/copy'

export function AuthPage() {
  const path = window.location.pathname.replace(/\/+$/, '')
  const recovery = path === '/auth/recovery',
    signup = path === '/auth/signup'
  const raw = new URLSearchParams(window.location.search).get('returnTo') || '/dashboard'
  const returnTo = /^\/(?:dashboard|jobs\/[A-Za-z0-9_-]+)?$/.test(raw) ? raw : '/dashboard'
  const suffix = `?returnTo=${encodeURIComponent(returnTo)}`
  const [ready, setReady] = useState<boolean | null>(null)
  const [signedIn, setSignedIn] = useState<string | null>(null)
  useEffect(() => {
    document.title = `${recovery ? 'Recover access' : signup ? 'Create your account' : 'Sign in'} — FJ - Find Jobs`
    let active = true
    void fetch('/api/auth/status', { cache: 'no-store' })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ configured: boolean }>) : null,
      )
      .then((status) => {
        if (active) setReady(Boolean(status?.configured))
      })
      .catch(() => {
        if (active) setReady(false)
      })
    void fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<{ authenticated: boolean; email: string }>) : null))
      .then((status) => {
        if (active && status?.authenticated) setSignedIn(status.email)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [recovery, signup])
  return (
    <>
      <main className="auth-page">
        <a className="auth-back" href="/">
          <ArrowLeft size={16} /> Back to opportunities
        </a>
        <div className="auth-layout">
          <section className="auth-story">
            <a className="brand" href="/">
              <img src="/favicon.svg" width="40" height="40" alt="" /> FJ — Find Jobs
            </a>
            <span className="eyebrow">Your next chapter starts here</span>
            <p className="auth-story__headline">
              Good opportunities.
              <br />
              Your own way forward.
            </p>
            <p>
              A calmer place to explore work, keep your shortlist and build a consistent application
              habit.
            </p>
            <ul>
              {[
                'Discover roles across countries and professions',
                'Keep your saved roles and preferences together',
                'Track the applications you confirm each month',
              ].map((text) => (
                <li key={text}>
                  <Check size={18} />
                  {text}
                </li>
              ))}
            </ul>
            <p className="field__hint">
              We link to opportunities. We are not employers or recruiters. Always verify the
              original listing before applying.
            </p>
          </section>
          <section className="auth-card" aria-labelledby="auth-heading">
            <ShieldCheck className="auth-icon" size={32} />
            <span className="eyebrow">Secure email sign-in</span>
            <h1 id="auth-heading">
              {signedIn
                ? 'You’re signed in'
                : recovery
                  ? 'Recover your account'
                  : signup
                    ? 'Create your free account'
                    : 'Welcome back'}
            </h1>
            {signedIn ? (
              <>
                <p>
                  Signed in as <strong>{signedIn}</strong>.
                </p>
                <a className="btn btn--primary" href={returnTo}>
                  Go to your dashboard <ArrowRight size={16} />
                </a>
                <a className="btn" href="/cdn-cgi/access/logout">
                  Sign out
                </a>
              </>
            ) : (
              <>
                {!recovery && (
                  <nav className="auth-tabs" aria-label="Account action">
                    <a
                      className="btn"
                      aria-current={signup ? 'page' : undefined}
                      href={'/auth/signup' + suffix}
                    >
                      Sign up
                    </a>
                    <a
                      className="btn"
                      aria-current={!signup ? 'page' : undefined}
                      href={'/auth/login' + suffix}
                    >
                      Sign in
                    </a>
                  </nav>
                )}
                <p>
                  {recovery
                    ? 'Forgot a password or lost a sign-in code? FJ is passwordless. Request a fresh one-time code using the same email as your account.'
                    : signup
                      ? 'Your first verified email sign-in creates your account. No password to remember, store or reset.'
                      : 'Use your account email. Cloudflare Access sends you a fresh one-time verification code.'}
                </p>
                {recovery && (
                  <div className="recovery-steps">
                    <h3>Get back in, safely</h3>
                    <ol>
                      <li>Continue to secure email verification.</li>
                      <li>Enter the email you used for FJ.</li>
                      <li>
                        Check your inbox and spam folder. Use the newest code before it expires.
                      </li>
                    </ol>
                    <p>
                      If you no longer control that inbox, recover the email account with your email
                      provider first. We cannot bypass email verification.
                    </p>
                  </div>
                )}
                {ready === null ? (
                  <p role="status">Checking secure sign-in…</p>
                ) : ready ? (
                  <a className="btn btn--primary auth-continue" href={'/api/auth/login' + suffix}>
                    <Mail size={17} />
                    {recovery ? 'Request a new sign-in code' : 'Continue with email'}
                    <ArrowRight size={17} />
                  </a>
                ) : (
                  <div className="banner banner--info" role="status">
                    {copy('auth.unavailable')}{' '}
                    <button className="btn btn--sm" onClick={() => window.location.reload()}>
                      Try again
                    </button>{' '}
                    You can still browse opportunities without an account.
                  </div>
                )}
                <p className="field__hint">
                  Enter your email and code only on our secure Cloudflare Access sign-in screen.
                  Never share a code with anyone.
                </p>
                <a
                  className="auth-recovery"
                  href={(recovery ? '/auth/login' : '/auth/recovery') + suffix}
                >
                  {recovery ? 'Back to sign in' : 'Forgot password or can’t sign in?'}
                </a>
              </>
            )}
            <p className="auth-free">Free to explore. No card required.</p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
