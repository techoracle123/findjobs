import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mail, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'
import { copy } from '../shared/copy'

/** Six-box one-time-code entry with paste, auto-advance and mobile autofill. */
function CodeBoxes({
  value,
  onChange,
  onDone,
}: {
  value: string
  onChange: (v: string) => void
  /** Receives the completed code directly — never reads stale state. */
  onDone: (code: string) => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.padEnd(6, ' ').slice(0, 6).split('')

  useEffect(() => {
    refs.current[0]?.focus()
  }, [])

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
            next[index] = event.target.value.replace(/\D/g, '').slice(-1)
            const joined = next.join('').replace(/\s/g, '')
            onChange(joined)
            if (event.target.value && index < 5) refs.current[index + 1]?.focus()
            if (joined.length === 6) onDone(joined)
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!pasted) return
            event.preventDefault()
            onChange(pasted)
            refs.current[Math.min(pasted.length, 5)]?.focus()
            if (pasted.length === 6) onDone(pasted)
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

const RESEND_COOLDOWN_SECONDS = 30
const LAST_EMAIL_KEY = 'fj-last-email'

/**
 * One page for sign-in, sign-up and recovery. FJ is passwordless: the same
 * email code creates the account on first use and signs you in after that,
 * so there is nothing to choose and nothing to remember.
 */
export function AuthPage() {
  const path = window.location.pathname.replace(/\/+$/, '')
  const recovery = path === '/auth/recovery'
  const raw = new URLSearchParams(window.location.search).get('returnTo') || '/dashboard'
  const returnTo = /^\/(?:dashboard|jobs\/[A-Za-z0-9_-]+)?$/.test(raw) ? raw : '/dashboard'
  const [email, setEmail] = useState(() => {
    try {
      return window.localStorage.getItem(LAST_EMAIL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [stage, setStage] = useState<'email' | 'code' | 'done'>('email')
  const [code, setCode] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [signedIn, setSignedIn] = useState<string | null>(null)
  const [devices, setDevices] = useState<Array<{ id: string; agent: string; lastSeenAt: number }>>(
    [],
  )

  useEffect(() => {
    document.title = `${recovery ? 'Recover access' : 'Sign in or create your account'} — FJ - Find Jobs`
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
  }, [recovery])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const requestCode = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        if (body?.error === 'email_not_configured') {
          setNotice(copy('auth.unavailable'))
          return
        }
        if (response.status === 429 || body?.error === 'rate_limited') {
          setNotice(copy('auth.rateLimited'))
          return
        }
        throw new Error('send-failed')
      }
      try {
        window.localStorage.setItem(LAST_EMAIL_KEY, email)
      } catch {
        /* Prefill is a nicety, never a blocker. */
      }
      setCode('')
      setStage('code')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setNotice(copy('auth.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  const verifyCode = async (candidate: string) => {
    if (candidate.length !== 6 || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: candidate }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        if (response.status === 429 || body.error === 'rate_limited')
          setNotice(copy('auth.rateLimited'))
        else if (body.error === 'code_expired') setNotice(copy('auth.codeExpired'))
        else if (body.error === 'code_used') setNotice(copy('auth.codeUsed'))
        else setNotice(copy('auth.codeInvalid'))
        // Clear the boxes and put the cursor back at the start.
        setCode('')
        setAttempt((value) => value + 1)
        return
      }
      setStage('done')
      setSignedIn(email)
      window.setTimeout(() => {
        window.location.href = returnTo
      }, 600)
    } catch {
      setNotice(copy('auth.codeInvalid'))
      setCode('')
      setAttempt((value) => value + 1)
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
            <a className="brand" href="/" aria-label="FJ - Find Jobs">
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
                'No password — one email code and you are in.',
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
                  {recovery ? 'Recover your account' : 'Sign in or create your free account'}
                </h1>
                <p>
                  {recovery
                    ? 'FJ has no passwords. Request a fresh one-time code using the same email as your account.'
                    : 'Enter your email and we will send you a 6-digit code. New here? The same code creates your free account — no password, no card, nothing else to fill in.'}
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
                        inputMode="email"
                        required
                        autoFocus
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="you@example.com"
                      />
                    </label>
                    <button className="btn btn--primary auth-continue" disabled={busy || !email}>
                      <Mail size={17} />
                      {busy ? 'Sending…' : 'Email me a code'}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                )}
                {stage === 'code' && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void verifyCode(code)
                    }}
                  >
                    <p className="field__hint">
                      We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
                      Not there? Check your spam folder.
                    </p>
                    <CodeBoxes
                      key={attempt}
                      value={code}
                      onChange={setCode}
                      onDone={(completed) => void verifyCode(completed)}
                    />
                    <button
                      className="btn btn--primary auth-continue"
                      disabled={busy || code.length !== 6}
                    >
                      {busy ? 'Checking…' : 'Continue'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || cooldown > 0}
                      onClick={() => {
                        setCode('')
                        void requestCode()
                      }}
                    >
                      {cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setStage('email')
                        setCode('')
                        setNotice(null)
                      }}
                    >
                      Use a different email
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
                  {recovery ? 'Back to sign in' : 'Can’t get into your email?'}
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
