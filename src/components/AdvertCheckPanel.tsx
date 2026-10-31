import { useState, type FormEvent } from 'react'
import { ClipboardCheck, Copy, ShieldAlert } from 'lucide-react'
import { runAdvertCheck } from '../lib/api'
import type { AdvertCheckResult, ProTrialState } from '../shared/types'

export function AdvertCheckResultView({ check }: { check: AdvertCheckResult }) {
  const [copied, setCopied] = useState(false)
  const riskLabel =
    check.riskLevel === 'warning-signs-found'
      ? 'Stop and check carefully'
      : check.riskLevel === 'caution'
        ? 'Use caution'
        : 'No warning signs found'
  const text = [
    'FJ advert check',
    check.headline,
    '',
    `Nigeria eligibility: ${check.nigeria.headline}`,
    ...check.nigeria.evidence.map((line) => `- ${line}`),
    '',
    'Warning signs:',
    ...(check.signals.length
      ? check.signals.map((signal) => `- ${signal.label}: ${signal.detail}`)
      : ['- None of the warning signs FJ checks for were found.']),
    '',
    'Before you apply:',
    ...check.nextSteps.map((line) => `- ${line}`),
    '',
    'This is not employer verification. Check the employer independently and never pay to get a job.',
  ].join('\n')

  return (
    <div className="advert-check-result stack">
      <div className="inline-head">
        <h3>Advert check result</h3>
        <span
          className={`status-pill ${check.riskLevel === 'warning-signs-found' ? 'status-danger' : ''}`}
        >
          {riskLabel}
        </span>
      </div>
      <p>{check.headline}</p>

      <section>
        <h4>Nigeria eligibility</h4>
        <p>
          <strong>{check.nigeria.headline}</strong>
        </p>
        {check.nigeria.evidence.length ? (
          <ul className="plain-list">
            {check.nigeria.evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">The advert does not state this clearly.</p>
        )}
        <p>
          <strong>Work permission:</strong>{' '}
          {check.nigeria.workAuthorization.length
            ? check.nigeria.workAuthorization.join(' · ')
            : 'Not stated'}
        </p>
        {check.nigeria.sponsorship.length ? (
          <p>
            <strong>Sponsorship words:</strong> {check.nigeria.sponsorship.join(' · ')}
          </p>
        ) : null}
        {check.nigeria.timeZones.length ? (
          <p>
            <strong>Time-zone words:</strong> {check.nigeria.timeZones.join(' · ')}
          </p>
        ) : null}
        {check.nigeria.countriesNamed.length ? (
          <p>
            <strong>Countries named:</strong> {check.nigeria.countriesNamed.join(', ')}
          </p>
        ) : null}
        {check.nigeria.notes.length ? (
          <ul className="plain-list">
            {check.nigeria.notes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h4>Warning signs</h4>
        {check.signals.length ? (
          <ul className="warning-list">
            {check.signals.map((signal) => (
              <li key={`${signal.label}-${signal.detail}`}>
                <strong>{signal.label}.</strong> {signal.detail}
                {signal.evidence ? (
                  <span className="evidence-quote"> “{signal.evidence}”</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            None of the warning signs FJ checks for were found. This does not verify the employer or
            prove the job is safe.
          </p>
        )}
      </section>

      <section>
        <h4>What the advert gives you</h4>
        <dl className="detail-list">
          <div>
            <dt>Pay</dt>
            <dd>{check.salaryStated ? 'Pay is stated in the advert' : 'Not stated'}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{check.deadlineText ?? 'Not stated'}</dd>
          </div>
          <div>
            <dt>Email contacts</dt>
            <dd>
              {check.contacts.emails.length ? check.contacts.emails.join(', ') : 'No email found'}
            </dd>
          </div>
          <div>
            <dt>Links</dt>
            <dd>
              {check.contacts.links.length ? check.contacts.links.join(', ') : 'No link found'}
            </dd>
          </div>
        </dl>
      </section>

      {check.missingInformation.length ? (
        <section>
          <h4>Ask or confirm before spending more time</h4>
          <ul className="plain-list">
            {check.missingInformation.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h4>Safe next steps</h4>
        <ol className="numbered-list">
          {check.nextSteps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </section>

      <button
        className="btn btn--sm"
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(text)
            .then(() => setCopied(true))
            .catch(() => {})
        }}
      >
        <Copy size={14} /> {copied ? 'Copied' : 'Copy this check'}
      </button>
      <p className="field__hint">
        This check reads the advert’s own words. It does not verify or endorse the employer.
      </p>
    </div>
  )
}

interface AdvertCheckPanelProps {
  proEnabled: boolean
  trial: ProTrialState
  onOpenPlan: () => void
}

export function AdvertCheckPanel({ proEnabled, trial, onOpenPlan }: AdvertCheckPanelProps) {
  const [title, setTitle] = useState('')
  const [company, setCompany] = useState('')
  const [location, setLocation] = useState('')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [result, setResult] = useState<AdvertCheckResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = await runAdvertCheck({ title, company, location, url, text })
      setResult(body.check)
    } catch {
      setError('We could not check the advert. Paste more of it and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="advert-check-heading">
      <div className="panel__head panel-head-row">
        <div>
          <p className="eyebrow">Before you send your CV</p>
          <h2 className="panel__title" id="advert-check-heading">
            Check any job advert
          </h2>
        </div>
        <ShieldAlert size={22} aria-hidden="true" />
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          Paste an advert from WhatsApp, Telegram, email, LinkedIn or another site. FJ checks what
          it says about Nigeria, work permission, fees and private documents.
        </p>
        <p className="field__hint">
          We use the advert for this check and do not save it. FJ does not approve companies. We
          show what the advert says so you can decide.
        </p>

        {!proEnabled ? (
          <div className="locked-box">
            <h3>Check before you apply</h3>
            <p>
              This tool is in Pro and in the free trial. You can also use it from each job page.
            </p>
            <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
              {trial.status === 'not_started' ? 'Start the free trial' : 'See Pro plans'}
            </button>
          </div>
        ) : (
          <form className="stack" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <label className="field">
                Job title <span className="optional">(optional)</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="field">
                Company <span className="optional">(optional)</span>
                <input value={company} onChange={(event) => setCompany(event.target.value)} />
              </label>
              <label className="field">
                Location <span className="optional">(optional)</span>
                <input value={location} onChange={(event) => setLocation(event.target.value)} />
              </label>
              <label className="field">
                Advert link <span className="optional">(optional)</span>
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://…"
                />
              </label>
            </div>
            <label className="field">
              Full advert text
              <textarea
                rows={10}
                required
                minLength={40}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste the duties, requirements, location, salary, deadline and how to apply"
              />
              <small>
                Paste as much as you safely can. Do not include your own private documents.
              </small>
            </label>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              <ClipboardCheck size={16} /> {busy ? 'Checking...' : 'Check this advert'}
            </button>
          </form>
        )}

        {error ? (
          <p className="banner banner--demo" role="alert">
            {error}
          </p>
        ) : null}
        {result ? <AdvertCheckResultView check={result} /> : null}
      </div>
    </section>
  )
}
