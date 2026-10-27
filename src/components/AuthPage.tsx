import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mail, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'
import { copy } from '../shared/copy'

/** Six-box one-time-code entry with paste and mobile SMS/OTP autofill. */
function CodeBoxes({
  value,
  onChange,
  onDone,
}: {
  value: string
  onChange: (v: string) => void
  onDone: () => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.padEnd(6, ' ').slice(0, 6).split('')
  return (
    <div className="code-boxes" role="group" aria-label="6-digit sign-in code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            refs.current[index] = element
          }}
          className="code-box"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1}`}
          maxLength={1}
          value={digit.trim()}
          onChange={(event) => {
            const next = value.padEnd(6, ' ').split('')
            next[index] = event.target.value.slice(-1)
            const joined = next.join('').replace(/\s/g, '')
            onChange(joined)
            if (event.target.value && index < 5) refs.current[index + 1]?.focus()
            if (joined.length === 6) onDone()
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!pasted) return
            event.preventDefault()
            onChange(pasted)
            refs.current[Math.min(pasted.length, 5)]?.focus()
            if (pasted.length === 6) onDone()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digit.trim() && index > 0)
              refs.current[index - 1]?.focus()
          }}
        />
      ))}
    </div>
  )
}

export function AuthPage() {
  const path = window.location.pathname.replace(/\/+$/, '')
  const recovery = path === '/auth/recovery',
    signup = path === '/auth/signup'
  const raw = new URLSearchParams(window.location.search).get('returnTo') || '/dashboard'
  const returnTo = /^\/(?:dashboard|jobs\/[A-Za-z0-9_-]+)?$/.test(raw) ? raw : '/dashboard'
  const [email, setEmail] = useState('')
  const [stage, setStage] = useState<'email' | 'code' | 'done'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState<string | null>(null)
  const [devices, setDevices] = useState<Array<{ id: string; agent: string; lastSeenAt: number }>>(
    [],
  )

  useEffect(() => {
    document.title = `${recovery ? 'Recover access' : signup ? 'Create your account' : 'Sign in'} — FJ - Find Jobs`
    void (async () => {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) return
      const body = (await response.json()) as { user?: { email: string } | null }
      if (!body.user) return
      setSignedIn(body.user.email)
      setStage('done')
      const devicesResponse = await fetch('/api/auth/devices', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!devicesResponse.ok) return
      const devicesBody = (await devicesResponse.json()) as {
        devices?: Array<{ id: string; agent: string; lastSeenAt: number }>
      }
      if (devicesBody.devices) setDevices(devicesBody.devices)
    })().catch(() => {})
  }, [recovery, signup])

  const requestCode = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) throw new Error('send-failed')
      setStage('code')
    } catch {
      setNotice(copy('auth.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async () => {
    if (code.length !== 6) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        if (body.error === 'code_expired') setNotice(copy('auth.codeExpired'))
        else if (body.error === 'code_used') setNotice(copy('auth.codeUsed'))
        else setNotice(copy('auth.codeInvalid'))
        return
      }
      setStage('done')
      setSignedIn(email)
      window.setTimeout(() => {
        window.location.href = returnTo
      }, 600)
    } catch {
      setNotice(copy('auth.codeInvalid'))
    } finally {
      setBusy(false)
    }
  }

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
                'Save opportunities and track every application.',
                'Get free alerts that match your skills.',
                'Passwordless sign-in — one email code and you are in.',
              ].map((line) => (
                <li key={line}>
                  <ShieldCheck size={16} /> {line}
                </li>
              ))}
            </ul>
          </section>
          <section className="auth-card" aria-label="Account">
            {signedIn ? (
              <>
                <h1>Signed in</h1>
                <p>
                  <Check size={16} /> {signedIn}
                </p>
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
                            Revoke
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <a className="btn btn--primary" href={returnTo}>
                  Continue
                </a>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
                      setSignedIn(null)
                      setStage('email')
                    })
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <h1 className="auth-card__title">
                  {recovery
                    ? 'Recover your account'
                    : signup
                      ? 'Create your free account'
                      : 'Welcome back'}
                </h1>
                {!recovery && (
                  <nav className="auth-tabs" aria-label="Account action">
                    <a
                      className="btn"
                      aria-current={signup ? 'page' : undefined}
                      href={'/auth/signup'}
                    >
                      Sign up
                    </a>
                    <a
                      className="btn"
                      aria-current={!signup ? 'page' : undefined}
                      href={'/auth/login'}
                    >
                      Sign in
                    </a>
                  </nav>
                )}
                <p>
                  {recovery
                    ? 'FJ is passwordless. Request a fresh one-time code using the same email as your account.'
                    : signup
                      ? 'Your first verified email sign-in creates your account. No password to remember, store or reset.'
                      : 'Use your account email. We send you a fresh one-time code.'}
                </p>
                {recovery && (
                  <div className="recovery-steps">
                    <h3>Get back in, safely</h3>
                    <ol>
                      <li>Enter the email you used for FJ.</li>
                      <li>
                        Check your inbox and spam folder. Use the newest code before it expires.
                      </li>
                      <li>
                        If you no longer control that inbox, recover it with your email provider
                        first.
                      </li>
                    </ol>
                  </div>
                )}
                {stage === 'email' && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void requestCode()
                    }}
                  >
                    <label className="field">
                      Email
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                      />
                    </label>
                    <button className="btn btn--primary auth-continue" disabled={busy || !email}>
                      <Mail size={17} />
                      Send me a code
                      <ArrowRight size={17} />
                    </button>
                  </form>
                )}
                {stage === 'code' && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void verifyCode()
                    }}
                  >
                    <p className="field__hint">Enter the 6-digit code we sent to {email}.</p>
                    <CodeBoxes value={code} onChange={setCode} onDone={() => void verifyCode()} />
                    <button
                      className="btn btn--primary auth-continue"
                      disabled={busy || code.length !== 6}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setCode('')
                        void requestCode()
                      }}
                    >
                      Send a new code
                    </button>
                  </form>
                )}
                {notice && (
                  <p className="banner banner--demo" role="status">
                    {notice}
                  </p>
                )}
                <p className="field__hint">
                  Never share a code with anyone. FJ staff will never ask for it.
                </p>
                <a className="auth-recovery" href={recovery ? '/auth/login' : '/auth/recovery'}>
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
