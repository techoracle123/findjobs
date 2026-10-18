import { Bookmark, BookmarkCheck, ExternalLink, Info, Send } from 'lucide-react'
import type { RatesPayload, ScoredJob } from '../shared/types'
import { ELIGIBILITY_LABELS } from '../shared/scoring'
import {
  formatRange,
  formatRelativeTime,
  freshnessOf,
  FRESHNESS_LABELS,
  PERIOD_LABELS,
} from '../shared/format'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'
import {
  applyLinkOf,
  isClosed,
  STATUS_LABELS,
  statusOf,
  VERIFICATION_DESCRIPTIONS,
  VERIFICATION_LABELS,
  verificationOf,
} from '../shared/verification'
import { countryName } from '../shared/countries'
import { ScoreBreakdown } from './ScoreBreakdown'
import type { SalaryView } from '../lib/ranking'

interface JobDetailProps {
  scored: ScoredJob | null
  salary: SalaryView | null
  rates: RatesPayload | null
  displayCurrency: string
  saved: boolean
  applied: boolean
  onSave: () => void
  onApply: () => void
}

const TIER_CLASS: Record<string, string> = {
  eligible: 'chip--ok',
  unknown: 'chip--warn',
  restricted: 'chip--danger',
}

export function JobDetail({
  scored,
  salary,
  rates,
  displayCurrency,
  saved,
  applied,
  onSave,
  onApply,
}: JobDetailProps) {
  if (!scored || !salary) {
    return (
      <aside className="detail">
        <div className="empty">
          <p className="empty__title">Select a role</p>
          <p>
            Pick any row to see the full breakdown: which skills matched, what is missing, how
            eligibility was assessed, and where the posting came from.
          </p>
        </div>
      </aside>
    )
  }

  const { job, score, tier, tierReason, components, matchedSkills, missingSkills } = scored
  const freshness = freshnessOf(job.postedAt)
  const hasProfile = components.some((component) => component.applicable)

  return (
    <aside className="detail">
      <div className="detail__head">
        <div className="chiprow">
          <span className="chip chip--plain">{roleFamilyLabel(job.roleFamily)}</span>
          <span className="chip chip--plain">{seniorityLabel(job.seniority)}</span>
          <span className="chip chip--plain">{workModeLabel(job.workMode)}</span>
          <span className={`chip ${TIER_CLASS[tier]}`}>{ELIGIBILITY_LABELS[tier]}</span>
        </div>
        <h2 className="detail__title">{job.title}</h2>
        <p className="detail__company">
          {job.company} · {job.locationLabel} ({countryName(job.locationCountry)})
        </p>
        <div className="btnrow">
          <button type="button" className="btn btn--sm" onClick={onSave}>
            {saved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
            {saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className="btn btn--primary btn--sm" onClick={onApply}>
            <Send size={13} />
            {applied ? 'Marked as applied' : 'Mark as applied'}
          </button>
        </div>
      </div>

      <div className="detail__body">
        <div>
          <h3 className="section__label">Match score</h3>
          {hasProfile ? (
            <ScoreBreakdown components={components} total={score} />
          ) : (
            <p className="detail__text" style={{ color: 'var(--muted)' }}>
              Add skills to your profile and the score will be calculated against your signal.
            </p>
          )}
        </div>

        <div>
          <h3 className="section__label">Skill fit</h3>
          {matchedSkills.length === 0 && missingSkills.length === 0 ? (
            <p className="detail__text" style={{ color: 'var(--muted)' }}>
              No skill signal yet.
            </p>
          ) : (
            <div className="skillsplit">
              <div className="skillsplit__col">
                <span className="field__hint">Matched</span>
                <div className="taglist">
                  {matchedSkills.length === 0 && <span className="field__hint">—</span>}
                  {matchedSkills.map((skill) => (
                    <span className="tag" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="skillsplit__col">
                <span className="field__hint">Missing</span>
                <div className="taglist">
                  {missingSkills.length === 0 && <span className="field__hint">—</span>}
                  {missingSkills.map((skill) => (
                    <span className="tag tag--muted" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <h3 className="section__label">Eligibility</h3>
          <div className={`banner banner--${tier === 'eligible' ? 'info' : 'demo'}`}>
            <Info size={15} />
            <span>{tierReason}</span>
          </div>
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="kv__key">Hiring regions</span>
            <span className="kv__value">
              {job.eligibleCountries.length === 0
                ? 'Not restricted'
                : job.eligibleCountries.join(', ')}
            </span>
          </div>
          <div className="kv">
            <span className="kv__key">Sponsorship</span>
            <span className="kv__value">
              {job.sponsorship === 'available'
                ? 'Offered'
                : job.sponsorship === 'unavailable'
                  ? 'Not offered'
                  : 'Not stated'}
            </span>
          </div>
        </div>

        <div>
          <h3 className="section__label">Compensation</h3>
          <div className="kv">
            <span className="kv__key">Posted range</span>
            <span className="kv__value">
              {formatRange(job.salaryMin, job.salaryMax, job.salaryCurrency)}
              {PERIOD_LABELS[job.salaryPeriod]}
            </span>
          </div>
          {salary.converted ? (
            <>
              <div className="kv">
                <span className="kv__key">In {displayCurrency}</span>
                <span className="kv__value">
                  {formatRange(salary.min, salary.max, salary.currency)}
                  {PERIOD_LABELS[salary.period]}
                </span>
              </div>
              <p className="rate">
                Indicative conversion at {rates?.date} (
                {rates?.source === 'frankfurter' ? 'Frankfurter' : 'offline reference rates'}). Pay
                periods are not annualised.
              </p>
            </>
          ) : salary.sameCurrency ? (
            <p className="rate">
              Already stated in {salary.currency}. Pay periods are not annualised.
            </p>
          ) : (
            <p className="rate">
              No rate available for {job.salaryCurrency}, so the original currency is shown.
            </p>
          )}
        </div>

        <div>
          <h3 className="section__label">About the role</h3>
          <p className="detail__text">{job.description}</p>
        </div>

        <div>
          <h3 className="section__label">Source, status &amp; freshness</h3>
          <div className="kv">
            <span className="kv__key">Source</span>
            <span className="kv__value">{job.sourceName}</span>
          </div>
          <div className="kv">
            <span className="kv__key">Status</span>
            <span className="kv__value">
              {STATUS_LABELS[statusOf(job)]}
              {job.closedAt ? ` · ${formatRelativeTime(job.closedAt)}` : ''}
            </span>
          </div>
          <div className="kv">
            <span className="kv__key">Verification</span>
            <span className="kv__value">
              {VERIFICATION_LABELS[verificationOf(job)]}
              {job.verificationReason ? ` — ${job.verificationReason}` : ''}
            </span>
          </div>
          <div className="kv">
            <span className="kv__key">Posted</span>
            <span className="kv__value">
              {formatRelativeTime(job.postedAt)} · {FRESHNESS_LABELS[freshness]}
            </span>
          </div>
          {job.lastSeenAt && (
            <div className="kv">
              <span className="kv__key">Last confirmed</span>
              <span className="kv__value">{formatRelativeTime(job.lastSeenAt)}</span>
            </div>
          )}
          <p className="rate">{VERIFICATION_DESCRIPTIONS[verificationOf(job)]}</p>
          {isClosed(job) && job.closedReason && (
            <p className="rate">
              This role closed: {job.closedReason}. It stays here so you know it existed, but it
              will not be offered as something to apply for.
            </p>
          )}
          <a
            className="btn btn--sm"
            style={{ marginTop: 8 }}
            href={applyLinkOf(job)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink size={13} />
            {isClosed(job) ? 'View the original listing' : 'Apply for this role'}
          </a>
        </div>
      </div>
    </aside>
  )
}
