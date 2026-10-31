import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'

const LAST_EMAIL_KEY = 'fj-last-email'

type Mode = 'signup' | 'login' | 'recovery' | 'reset'

function modeFromPath(): Mode {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === '/auth/signup') return 'signup'
  if (path === '/auth/recovery') return 'recovery'
  if (path === '/auth/reset') return 'reset'
  return 'login'
}

/** Only plain in-app destinations may be returned to after sign-in. */
function safeReturnTo(): string {
  const raw = new URLSearchParams(window.location.search).get('returnTo') || '/jobs'
  return /^\/(?:dashboard|profile|jobs(?:\/[A-Za-z0-9_-]+)?)?$/.test(raw) ? raw : '/jobs'
}

async function postJson(
  path: string,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; error?: string; message?: string }> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string }
    return { ok: response.ok, status: response.status, error: data.error, message: data.message }
  } catch {
    return { ok: false, status: 0 }
  }
}

/** Turns a server answer into one plain sentence a person can act on. */
function explain(result: { status: number; error?: string; message?: string }): string {
  if (result.status === 429 || result.error === 'rate_limited')
    return 'Too many tries in a short time. Please wait a few minutes, then try again.'
  switch (result.error) {
    case 'account_exists':
      return 'That email already has an account. Please sign in. If you have forgotten the password, use Forgot password below.'
    case 'invalid_credentials':
      return 'That email and password do not match. Check them and try again. If you joined earlier with an email code and never set a password, use Forgot password to set one now.'
    case 'weak_password':
      return result.message ?? 'Please choose a longer password.'
    case 'bad_email':
      return 'That email address does not look complete. Check it and try again.'
    case 'reset_invalid':
      return 'That reset link is no longer valid. Links work once and expire after one hour. Please request a new one.'
    default:
      return 'Something went wrong on our side. Please try again in a few minutes.'
  }
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  hint?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input
          id={id}
          className="input"
          type={visible ? 'text' : 'password'}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder="Your password"
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  )
}

/**
 * Sign up, sign in, forgot password and reset password. One page, plain
 * email and password, built and run by FJ itself.
 */
export function AuthPage() {
  const mode = modeFromPath()
  const returnTo = safeReturnTo()
  const resetToken = new URLSearchParams(window.location.search).get('token') ?? ''
  const [name, setName] = useState('')
  const [email, setEmail] = useState(() => {
    try {
      return window.localStorage.getItem(LAST_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [signedIn, setSignedIn] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const [devices, setDevices] = useState<Array<{ id: string; agent: string; lastSeenAt: number }>>(
    [],
  )

  useEffect(() => {
    document.title =
      mode === 'signup'
        ? 'Create your free account. FJ - Find Jobs'
        : mode === 'recovery'
          ? 'Forgot password. FJ - Find Jobs'
          : mode === 'reset'
            ? 'Choose a new password. FJ - Find Jobs'
            : 'Sign in. FJ - Find Jobs'
    void (async () => {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (response.ok) {
          const body = (await response.json()) as { user?: { email: string } | null }
          if (body.user) {
            setSignedIn(body.user.email)
            const devicesResponse = await fetch('/api/auth/devices', {
              credentials: 'same-origin',
              cache: 'no-store',
            })
            if (devicesResponse.ok) {
              const devicesBody = (await devicesResponse.json()) as {
                devices?: Array<{ id: string; agent: string; lastSeenAt: number }>
              }
              if (devicesBody.devices) setDevices(devicesBody.devices)
            }
          }
        }
      } catch {
        /* The form below still works when this check cannot run. */
      } finally {
        setChecking(false)
      }
    })()
  }, [mode])

  const rememberEmail = () => {
    try {
      window.localStorage.setItem(LAST_EMAIL_KEY, email)
    } catch {
      /* Prefill next time is a nicety, never a blocker. */
    }
  }

  const finish = () => {
    rememberEmail()
    setSignedIn(email)
    window.setTimeout(() => {
      window.location.href = returnTo
    }, 500)
  }

  const submitSignup = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await postJson('/api/auth/signup', { name, email, password })
    setBusy(false)
    if (result.ok) finish()
    else setNotice(explain(result))
  }

  const submitLogin = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await postJson('/api/auth/login', { email, password })
    setBusy(false)
    if (result.ok) finish()
    else setNotice(explain(result))
  }

  const submitForgot = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await postJson('/api/auth/password/forgot', { email })
    setBusy(false)
    if (result.ok) {
      rememberEmail()
      setSent(true)
    } else setNotice(explain(result))
  }

  const submitReset = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await postJson('/api/auth/password/reset', { token: resetToken, password })
    setBusy(false)
    if (result.ok) {
      window.location.href = '/jobs'
    } else setNotice(explain(result))
  }

  const heading =
    mode === 'signup'
      ? 'Create your free account'
      : mode === 'recovery'
        ? 'Forgot your password?'
        : mode === 'reset'
          ? 'Choose a new password'
          : 'Welcome back. Sign in.'

  return (
    <>
      <main className="auth-page">
        <a className="auth-back" href="/">
          <ArrowLeft size={16} /> Back to home
        </a>
        <div className="auth-layout">
          <section className="auth-story">
            <a className="brand" href="/" aria-label="FJ - Find Jobs">
              <img src="/favicon.svg" width="40" height="40" alt="" /> FJ. Find Jobs
            </a>
            <p className="auth-story__headline">
              Thousands of jobs.
              <br />
              One place to find them.
            </p>
            <p>
              We gather real job adverts from many companies in Nigeria and abroad, so you can stop
              checking many websites and start applying.
            </p>
            <ul>
              {[
                'See jobs in Nigeria and remote jobs open to Nigerians.',
                'Save the jobs you like and keep track of where you applied.',
                'Get free alerts when new jobs that fit you arrive.',
                'Your account is free. No card is needed.',
              ].map((line) => (
                <li key={line}>
                  <ShieldCheck size={16} /> {line}
                </li>
              ))}
            </ul>
          </section>
          <section className="auth-card" aria-label="Account">
            {checking ? (
              <p role="status">
                <span className="spinner" /> Checking your account...
              </p>
            ) : signedIn && mode !== 'reset' ? (
              <>
                <h1 className="auth-card__title">You are signed in</h1>
                <p>
                  <Check size={16} /> {signedIn}
                </p>
                <a className="btn btn--primary auth-continue" href={returnTo}>
                  Continue to jobs
                </a>
                {devices.length > 0 && (
                  <div className="device-list">
                    <h2>Your devices</h2>
                    <ul>
                      {devices.map((device) => (
                        <li key={device.id}>
                          <span>{device.agent}</span>
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => {
                              void fetch('/api/auth/devices/revoke', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: device.id }),
                              }).then(() =>
                                setDevices((list) => list.filter((d) => d.id !== device.id)),
                              )
                            }}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  type="button"
                  className="btn auth-continue"
                  onClick={() => {
                    void fetch('/api/auth/logout', { method: 'POST' }).then(() => setSignedIn(null))
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <h1 className="auth-card__title">{heading}</h1>
                {mode === 'signup' && (
                  <p>
                    You need a free account to see the jobs. It takes less than a minute. We will
                    never ask you to pay before you can look at jobs or apply.
                  </p>
                )}
                {mode === 'login' && <p>Sign in with the email and password for your account.</p>}
                {mode === 'recovery' && !sent && (
                  <p>
                    Type the email for your account. We will email you a link to choose a new
                    password. The link works once and expires after one hour.
                  </p>
                )}
                {mode === 'reset' && (
                  <p>Choose a new password for your account. After this, we will sign you in.</p>
                )}

                {mode === 'recovery' && sent ? (
                  <>
                    <p className="banner banner--info" role="status">
                      If that email has an FJ account, we have sent a reset link to it. Please check
                      your inbox and your spam folder. The link expires in one hour.
                    </p>
                    <a className="btn btn--primary auth-continue" href="/auth/login">
                      Back to sign in
                    </a>
                  </>
                ) : mode === 'reset' ? (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitReset()
                    }}
                  >
                    <PasswordField
                      id="auth-new-password"
                      label="New password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="new-password"
                      hint="Use at least 8 characters. A short sentence you can remember works well."
                    />
                    <button className="btn btn--primary auth-continue" disabled={busy}>
                      {busy ? 'Saving...' : 'Save new password'}
                    </button>
                  </form>
                ) : mode === 'recovery' ? (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitForgot()
                    }}
                  >
                    <div className="field">
                      <label className="field__label" htmlFor="auth-email">
                        Email
                      </label>
                      <input
                        id="auth-email"
                        className="input"
                        type="email"
                        inputMode="email"
                        required
                        autoFocus
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </div>
                    <button className="btn btn--primary auth-continue" disabled={busy || !email}>
                      {busy ? 'Sending...' : 'Send reset link'}
                    </button>
                  </form>
                ) : (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void (mode === 'signup' ? submitSignup() : submitLogin())
                    }}
                  >
                    {mode === 'signup' && (
                      <div className="field">
                        <label className="field__label" htmlFor="auth-name">
                          Your name
                        </label>
                        <input
                          id="auth-name"
                          className="input"
                          type="text"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          autoComplete="name"
                          placeholder="For example, Adaeze Okafor"
                        />
                      </div>
                    )}
                    <div className="field">
                      <label className="field__label" htmlFor="auth-email">
                        Email
                      </label>
                      <input
                        id="auth-email"
                        className="input"
                        type="email"
                        inputMode="email"
                        required
                        autoFocus={mode === 'login'}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </div>
                    <PasswordField
                      id="auth-password"
                      label="Password"
                      value={password}
                      onChange={setPassword}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      hint={
                        mode === 'signup'
                          ? 'Use at least 8 characters. A short sentence you can remember works well.'
                          : undefined
                      }
                    />
                    <button
                      className="btn btn--primary auth-continue"
                      disabled={busy || !email || !password}
                    >
                      {busy
                        ? mode === 'signup'
                          ? 'Creating your account...'
                          : 'Signing you in...'
                        : mode === 'signup'
                          ? 'Create free account'
                          : 'Sign in'}
                    </button>
                  </form>
                )}

                {notice && (
                  <p className="banner banner--demo" role="alert">
                    {notice}
                  </p>
                )}

                <div className="auth-links">
                  {mode === 'login' && <a href="/auth/recovery">Forgot password?</a>}
                  {mode === 'signup' && (
                    <span>
                      Already have an account?{' '}
                      <a href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a>
                    </span>
                  )}
                  {mode === 'login' && (
                    <span>
                      New here?{' '}
                      <a href={`/auth/signup?returnTo=${encodeURIComponent(returnTo)}`}>
                        Create a free account
                      </a>
                    </span>
                  )}
                  {(mode === 'reset' || (mode === 'recovery' && !sent)) && (
                    <a href="/auth/login">Back to sign in</a>
                  )}
                </div>
                <p className="field__hint">
                  Never share your password with anybody. FJ will never ask you for it.
                </p>
              </>
            )}
            <p className="auth-free">Free to join. No card required.</p>
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
