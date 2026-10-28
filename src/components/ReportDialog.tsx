import { useState } from 'react'
import { Flag, X } from 'lucide-react'

const REASONS: { id: string; label: string }[] = [
  { id: 'scam', label: 'This looks like a scam' },
  { id: 'asked-me-for-money', label: 'They asked me for money' },
  { id: 'role-closed', label: 'The role no longer exists' },
  { id: 'wrong-category', label: 'Wrong category' },
  { id: 'discriminatory', label: 'Discriminatory content' },
  { id: 'other', label: 'Something else' },
]

/** Open to everyone: warning others must not require an account. */
export function ReportDialog({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')

  const submit = async () => {
    if (!reason) return
    setState('sending')
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, comment }),
      })
      if (!response.ok && response.status !== 201) throw new Error('report_failed')
      setState('done')
    } catch {
      setState('error')
    }
  }

  return (
    <dialog className="auth-dialog" open aria-labelledby="report-title">
      <div className="auth-dialog__body">
        <button
          type="button"
          className="btn btn--ghost auth-dialog__close"
          aria-label="Close report window"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <Flag size={26} aria-hidden="true" />
        <h2 id="report-title">Report this job</h2>
        {state === 'done' ? (
          <p role="status">
            Thank you. Your report is with our review team. Two independent reports hide a listing
            automatically while we check it.
          </p>
        ) : (
          <>
            <p>No account needed. We never share who reported.</p>
            <fieldset className="field">
              <legend className="field__label">What is wrong?</legend>
              {REASONS.map((item) => (
                <label key={item.id} className="cv-notice" style={{ margin: '4px 0' }}>
                  <input
                    type="radio"
                    name="report-reason"
                    value={item.id}
                    checked={reason === item.id}
                    onChange={() => setReason(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label className="field__label" htmlFor="report-comment">
                Anything else? (optional)
              </label>
              <textarea
                id="report-comment"
                className="input"
                rows={3}
                maxLength={500}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
            {state === 'error' && (
              <p className="banner banner--demo" role="alert">
                We could not send the report just now. Please try again.
              </p>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={!reason || state === 'sending'}
              onClick={() => void submit()}
            >
              {state === 'sending' ? 'Sending…' : 'Send report'}
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
