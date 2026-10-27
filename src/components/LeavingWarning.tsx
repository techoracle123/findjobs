import { useEffect, useState } from 'react'

const KEY = 'rolesignal:leaving-fj-ack'

const FLAGS = [
  'Never pay to apply — registration, training or “processing” fees are the classic scam.',
  'Never send your BVN, bank details or ID copies to a “recruiter” over chat.',
  'Check the employer’s official website and confirm the vacancy there before you apply.',
]

/**
 * Shown once per browser session the first time someone leaves for an
 * employer's site. After that the apply link is one tap, as it should be.
 */
export function LeavingWarning({
  open,
  href,
  onContinue,
  onCancel,
}: {
  open: boolean
  href: string
  onContinue: () => void
  onCancel: () => void
}) {
  const [seen, setSeen] = useState(true)
  useEffect(() => {
    if (!open) return
    try {
      setSeen(sessionStorage.getItem(KEY) === '1')
    } catch {
      setSeen(false)
    }
  }, [open])

  if (!open || seen) return null
  return (
    <dialog className="auth-dialog" open aria-labelledby="leaving-title">
      <div className="auth-dialog__body">
        <h2 id="leaving-title">You are leaving FJ</h2>
        <p>
          FJ never asks you to pay for a job or an application. You are about to open the employer’s
          own site:
        </p>
        <ul className="leaving-flags">
          {FLAGS.map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
        <div className="btnrow">
          <a
            className="btn btn--primary"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              try {
                sessionStorage.setItem(KEY, '1')
              } catch {
                /* Optional. */
              }
              onContinue()
            }}
          >
            Continue to the employer’s site
          </a>
          <button type="button" className="btn" onClick={onCancel}>
            Stay on FJ
          </button>
        </div>
      </div>
    </dialog>
  )
}
