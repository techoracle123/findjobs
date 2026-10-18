import { useEffect, useRef } from 'react'
import { ArrowRight, Mail, X } from 'lucide-react'

export type AuthMode = 'signup' | 'signin' | 'recovery'

interface AuthDialogProps {
  mode: AuthMode | null
  loginUrl: string | null
  email?: string
  onMode: (mode: AuthMode) => void
  onClose: () => void
}

/** Native dialog supplies focus containment, Escape and focus restoration. */
export function AuthDialog({ mode, loginUrl, email, onMode, onClose }: AuthDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (mode && !dialog.current?.open) dialog.current?.showModal()
    if (!mode && dialog.current?.open) dialog.current.close()
  }, [mode])

  return (
    <dialog
      ref={dialog}
      className="auth-dialog"
      aria-labelledby="account-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="auth-dialog__body">
        <button
          type="button"
          className="btn btn--ghost auth-dialog__close"
          onClick={onClose}
          aria-label="Close account window"
        >
          <X size={20} />
        </button>
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <span className="eyebrow">FJ - Find Jobs</span>
        <h2 id="account-title">
          {email
            ? 'Your account'
            : mode === 'signup'
              ? 'Create your free account'
              : mode === 'recovery'
                ? 'Let’s get you back in'
                : 'Welcome back'}
        </h2>
        {email ? (
          <>
            <p className="account-address">Signed in as {email}</p>
            <p>
              Your saved jobs and preferences sync to this account. Your account will also work on
              another device.
            </p>
            <a className="btn" href="/cdn-cgi/access/logout">
              Sign out
            </a>
          </>
        ) : (
          <>
            {mode !== 'recovery' && (
              <div className="auth-tabs" aria-label="Choose account action">
                <button
                  type="button"
                  className="btn"
                  aria-pressed={mode === 'signup'}
                  onClick={() => onMode('signup')}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={mode === 'signin'}
                  onClick={() => onMode('signin')}
                >
                  Sign in
                </button>
              </div>
            )}
            <p>
              {mode === 'recovery'
                ? 'Forgot your password? There isn’t one to reset. FJ uses a fresh, secure email code each time you sign in.'
                : mode === 'signup'
                  ? 'Save opportunities and keep your preferences across devices. Your first email sign-in creates your account. No password to remember.'
                  : 'Use the same email you used before. We’ll send you a one-time sign-in code—no password needed.'}
            </p>
            {mode === 'recovery' && (
              <p>
                Request a new code, check your inbox and spam folder, and use the latest code. Never
                share it. You’ll need access to the email address linked to your account.
              </p>
            )}
            {loginUrl ? (
              <a className="btn btn--primary auth-dialog__continue" href={loginUrl}>
                <Mail size={17} />{' '}
                {mode === 'recovery' ? 'Get a new sign-in code' : 'Continue with email'}{' '}
                <ArrowRight size={16} />
              </a>
            ) : (
              <p className="banner banner--info" role="status">
                Account access is temporarily unavailable. You can still browse and save jobs on
                this device. Please try again shortly.
              </p>
            )}
            {mode !== 'recovery' ? (
              <button type="button" className="btn btn--ghost" onClick={() => onMode('recovery')}>
                Forgot password or can’t sign in?
              </button>
            ) : (
              <button type="button" className="btn btn--ghost" onClick={() => onMode('signin')}>
                Back to sign in
              </button>
            )}
            <span className="field__hint">
              Browsing is always free. No account is required to explore jobs.
            </span>
          </>
        )}
      </div>
    </dialog>
  )
}
