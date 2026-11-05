import { useState } from 'react'
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  CircleX,
  MapPinCheck,
} from 'lucide-react'
import { ApiError, fetchMatchIntelligence } from '../lib/api'
import { opportunityBadge } from '../shared/opportunities'
import type {
  Job,
  MatchIntelligenceResult,
  MatchRequirement,
  MatchRequirementGroup,
  MatchRequirementStatus,
  ProTrialState,
} from '../shared/types'

interface MatchIntelligencePanelProps {
  job: Job
  onOpenJob?: (job: Job) => void
  onComplete?: (trial?: ProTrialState) => void
}

const GROUP_ORDER: Array<{ id: MatchRequirementGroup; title: string }> = [
  { id: 'essential', title: 'Must-have requirements' },
  { id: 'desirable', title: 'Nice-to-have requirements' },
  { id: 'eligibility', title: 'Location and work rules' },
  { id: 'practical', title: 'Practical fit' },
]

const STATUS_LABELS: Record<MatchRequirementStatus, string> = {
  met: 'Shown in your CV or profile',
  partial: 'Partly shown',
  missing: 'Not shown',
  'needs-check': 'Needs checking',
}

function StatusIcon({ status }: { status: MatchRequirementStatus }) {
  if (status === 'met') return <CheckCircle2 size={16} aria-hidden="true" />
  if (status === 'partial') return <CircleAlert size={16} aria-hidden="true" />
  if (status === 'missing') return <CircleX size={16} aria-hidden="true" />
  return <CircleHelp size={16} aria-hidden="true" />
}

function RequirementRow({ item }: { item: MatchRequirement }) {
  return (
    <article className={`match-requirement match-requirement--${item.status}`}>
      <div className="inline-head">
        <h5>{item.label}</h5>
        <span className={`status-pill match-status match-status--${item.status}`}>
          <StatusIcon status={item.status} /> {STATUS_LABELS[item.status]}
        </span>
      </div>
      <p>{item.detail}</p>
      {item.evidence.length > 0 ? (
        <ul className="evidence-list">
          {item.evidence.slice(0, 3).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <p className="match-requirement__action">
        <strong>Next:</strong> {item.action}
      </p>
    </article>
  )
}

function percentage(value: number | null, label: string) {
  return (
    <div className="match-metric">
      <strong>{value === null ? 'Not enough information' : `${value}%`}</strong>
      <span>{label}</span>
    </div>
  )
}

function serverMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  try {
    const parsed = JSON.parse(error.body) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : null
  } catch {
    return null
  }
}

export function MatchIntelligencePanel({
  job,
  onOpenJob,
  onComplete,
}: MatchIntelligencePanelProps) {
  const [cvText, setCvText] = useState('')
  const [result, setResult] = useState<MatchIntelligenceResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const runCheck = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const body = await fetchMatchIntelligence(job.id, cvText)
      setResult(body.match)
      onComplete?.(body.trial)
    } catch (error) {
      setMessage(serverMessage(error) ?? 'Match Intelligence could not finish. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pro-step match-intelligence">
      <p className="eyebrow">FJ Match Intelligence</p>
      <h3>
        <BrainCircuit size={18} aria-hidden="true" /> 2. Decide if this advert is worth your time
      </h3>
      <p>
        FJ compares the advert with your saved CV and profile. It shows which requirements you meet,
        which skills are missing, whether the location works for you, and other adverts that may fit
        you better.
      </p>
      <p className="field__hint">
        FJ uses the words in your CV and the advert. It cannot predict whether you will get the job.
      </p>

      <div className="field">
        <label className="field__label" htmlFor={`match-cv-${job.id}`}>
          Use different CV text (optional)
        </label>
        <textarea
          id={`match-cv-${job.id}`}
          className="textarea"
          rows={5}
          value={cvText}
          onChange={(event) => setCvText(event.target.value)}
          placeholder="Leave empty to use your saved CV or profile. Text pasted here is used only for this check."
        />
      </div>
      <button
        className="btn btn--primary"
        type="button"
        disabled={busy}
        onClick={() => void runCheck()}
      >
        {busy
          ? 'Checking the evidence...'
          : result
            ? 'Run the check again'
            : 'Run Match Intelligence'}
      </button>
      {message ? (
        <p className="banner banner--info" role="status">
          {message}
        </p>
      ) : null}

      {result ? (
        <div className="match-result stack" aria-live="polite">
          <div className="match-result__hero">
            <div>
              <p className="eyebrow">Your result</p>
              <h4>{result.headline}</h4>
              <p>{result.summary}</p>
              <p className="field__hint">
                Based on{' '}
                {result.basis === 'cv-and-profile' ? 'your CV and profile' : 'your profile'}. How
                certain FJ is: {result.confidence}. Checked{' '}
                {new Date(result.generatedAt).toLocaleString('en-NG')}.
              </p>
            </div>
            <div
              className="match-score"
              aria-label={`Overall match score ${result.fitScore} out of 100`}
            >
              <strong>{result.fitScore}</strong>
              <span>match score / 100</span>
              <meter min={0} max={100} value={result.fitScore}>
                {result.fitScore}%
              </meter>
            </div>
          </div>

          <div className="match-metrics" aria-label="Match measures">
            {percentage(result.essentialPercent, 'must-have requirements met')}
            {percentage(result.desirablePercent, 'nice-to-have requirements met')}
            {percentage(result.evidencePercent, 'requirements shown in your CV or profile')}
          </div>

          <section className={`match-eligibility match-eligibility--${result.eligibility.status}`}>
            <h4>
              <MapPinCheck size={17} aria-hidden="true" /> {result.eligibility.headline}
            </h4>
            {result.eligibility.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
            {result.eligibility.evidence.length ? (
              <ul className="evidence-list">
                {result.eligibility.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="match-two-column">
            <section>
              <h4>Your matching qualifications</h4>
              {result.strengths.length ? (
                <ul className="plain-list">
                  {result.strengths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No strong match was clear from the CV or profile supplied.</p>
              )}
            </section>
            <section>
              <h4>Missing skills and gaps</h4>
              {result.gaps.length ? (
                <ul className="plain-list">
                  {result.gaps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>No major gap was clear from the requirements FJ checked.</p>
              )}
            </section>
          </div>

          <section>
            <h4>What to do next</h4>
            <ol className="numbered-list">
              {result.actions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          {GROUP_ORDER.map((group) => {
            const items = result.requirements.filter((item) => item.group === group.id)
            if (!items.length) return null
            return (
              <section key={group.id} className="match-group">
                <h4>{group.title}</h4>
                <div className="match-requirements">
                  {items.map((item) => (
                    <RequirementRow key={`${group.id}-${item.label}`} item={item} />
                  ))}
                </div>
              </section>
            )
          })}

          {result.alternatives.length ? (
            <section>
              <h4>Other adverts that may fit you better</h4>
              <div className="best-match-grid">
                {result.alternatives.map((alternative) => {
                  const badge = opportunityBadge(alternative.job)
                  return (
                    <article className="best-match-card" key={alternative.job.id}>
                      <div className="inline-head">
                        <div>
                          <h5>{alternative.job.title}</h5>
                          <p className="muted">
                            {alternative.job.company} · {alternative.job.locationLabel}
                          </p>
                        </div>
                        <span className="status-pill status-open">
                          Match score {alternative.score}/100
                        </span>
                      </div>
                      {badge ? <span className="chip chip--gig">{badge}</span> : null}
                      <p>
                        Must-have requirements met:{' '}
                        {alternative.essentialPercent === null
                          ? 'not enough information'
                          : `${alternative.essentialPercent}%`}
                      </p>
                      <ul className="plain-list">
                        {alternative.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      {alternative.missingEssential.length ? (
                        <p>
                          <strong>Still not shown:</strong>{' '}
                          {alternative.missingEssential.join(', ')}
                        </p>
                      ) : null}
                      {onOpenJob ? (
                        <button
                          className="btn btn--sm"
                          type="button"
                          onClick={() => onOpenJob(alternative.job)}
                        >
                          View this advert <ArrowRight size={14} />
                        </button>
                      ) : (
                        <a
                          className="btn btn--sm"
                          href={`/jobs/${encodeURIComponent(alternative.job.id)}`}
                        >
                          View this advert <ArrowRight size={14} />
                        </a>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section className="match-limitations">
            <h4>Read this before you decide</h4>
            <ul className="plain-list">
              {result.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  )
}
