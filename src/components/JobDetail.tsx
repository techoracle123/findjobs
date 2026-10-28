import { useState } from 'react'
import { Bookmark, BookmarkCheck, ExternalLink, Flag, Send } from 'lucide-react'
import type { Profile, RatesPayload, ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime, PERIOD_LABELS } from '../shared/format'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'
import { applyLinkOf, isClosed } from '../shared/verification'
import { ScoreBreakdown } from './ScoreBreakdown'
import { recordApplyClick } from '../lib/api'
import { copy } from '../shared/copy'
import { ReportDialog } from './ReportDialog'
import { LeavingWarning } from './LeavingWarning'
import type { SalaryView } from '../lib/ranking'

interface JobDetailProps {
  scored: ScoredJob | null
  salary: SalaryView | null
  profile: Profile
  rates: RatesPayload | null
  displayCurrency: string
  saved: boolean
  applied: boolean
  onSave: () => void
  onApply: () => void
  onFastApply?: () => Promise<void>
  cautionBannerEnabled?: boolean
  applyQuota?: { remaining: number; unlimited: boolean; resetsAt: string } | null
}

export function JobDetail({
  scored,
  salary,
  profile,
  rates,
  displayCurrency,
  saved,
  applied,
  onSave,
  onApply,
  onFastApply,
  applyQuota,
  cautionBannerEnabled = false,
}: JobDetailProps) {
  const [fastApplying, setFastApplying] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [fastMessage, setFastMessage] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  if (!scored || !salary) return null
  const { job } = scored
  const closed = isClosed(job)
  const applyUrl = applyLinkOf(job)
  const hasPay = job.salaryMin > 0 || job.salaryMax > 0
  const description = job.descriptionPreview ? 'Loading the full listing…' : job.description

  return (
    <article className="detail">
      <header className="detail__head">
        <p className="eyebrow">{job.company || 'Employer not stated'}</p>
        <h1 className="detail__title">{job.title}</h1>
        <p className="detail__company">
          {job.locationLabel}
          {job.workMode !== 'unknown' ? ` · ${workModeLabel(job.workMode)}` : ''}
        </p>
        <div className="job-facts">
          {job.roleFamily !== 'unknown' && <span>{roleFamilyLabel(job.roleFamily)}</span>}
          {job.seniority !== 'unknown' && <span>{seniorityLabel(job.seniority)}</span>}
          {job.postedAt && <span>Posted {formatRelativeTime(job.postedAt)}</span>}
        </div>
        {closed && (
          <p className="banner banner--info">
            This listing has closed. It is kept here for your saved-job records.
          </p>
        )}
        {fastMessage && (
          <p
            className={`banner ${fastMessage.tone === 'ok' ? 'banner--info' : 'banner--demo'}`}
            role="status"
          >
            {fastMessage.text}
          </p>
        )}
        {!closed &&
          job.applyMode === 'onsite' &&
          applyQuota &&
          !applyQuota.unlimited &&
          applyQuota.remaining <= 0 && (
            <div className="banner banner--info" role="status">
              <p>
                You’ve used all 5 free applications today.{' '}
                <a href="/dashboard?tab=plan">Upgrade to Pro for unlimited — ₦10,000/month</a>. You
                can still apply directly on the employer’s site — that’s always free.
              </p>
            </div>
          )}
        {job.moderationState === 'caution' && cautionBannerEnabled && (
          <p className="banner banner--demo" role="status">
            {copy('trust.caution')}
          </p>
        )}
        {job.applyMode !== 'onsite' && applyUrl && (
          <p className="leaving-line">{copy('trust.thirdParty')}</p>
        )}
        <div className="btnrow job-actions">
          {!closed && applyUrl && job.applyMode !== 'onsite' && (
            <a
              className="btn btn--primary"
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="external-apply"
              onClick={(event) => {
                recordApplyClick(job.id)
                if (leaving) return
                event.preventDefault()
                setLeaving(true)
              }}
            >
              Apply for this role <ExternalLink size={14} />
            </a>
          )}
          {!closed && job.applyMode === 'onsite' && (
            <button
              className="btn btn--primary"
              type="button"
              data-testid="fast-apply"
              disabled={
                fastApplying ||
                Boolean(applyQuota && !applyQuota.unlimited && applyQuota.remaining <= 0)
              }
              onClick={async () => {
                setFastApplying(true)
                setFastMessage(null)
                try {
                  await onFastApply?.()
                  setFastMessage({
                    tone: 'ok',
                    text: 'Your application has been sent to the employer.',
                  })
                } catch (error) {
                  setFastMessage({
                    tone: 'warn',
                    text:
                      error instanceof Error
                        ? error.message
                        : 'Your application could not be sent.',
                  })
                } finally {
                  setFastApplying(false)
                }
              }}
            >
              <Send size={14} /> {fastApplying ? 'Sending…' : 'Fast Apply'}
            </button>
          )}
          {!closed && job.applyMode === 'onsite' && applyUrl && (
            <a className="btn" href={applyUrl} target="_blank" rel="noopener noreferrer">
              Apply on employer site <ExternalLink size={13} />
            </a>
          )}
          <button className="btn" type="button" onClick={onSave}>
            {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
            {saved ? 'Saved' : 'Save'}
          </button>
          <button className="btn btn--ghost" type="button" disabled={applied} onClick={onApply}>
            <Send size={14} />
            {applied ? 'Applied' : 'Mark as applied'}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setReporting(true)}>
            <Flag size={14} /> Report this job
          </button>
        </div>
      </header>
      <div className="detail__body">
        <section className="detail-section">
          <h2>Salary</h2>
          <p className="salary-figure">
            {salary.converted ? '≈ ' : ''}
            {formatRange(salary.min, salary.max, salary.currency)}
            {hasPay ? ` ${PERIOD_LABELS[salary.period]}` : ''}
          </p>
          {hasPay && salary.converted && (
            <p className="field__hint">
              Original: {formatRange(job.salaryMin, job.salaryMax, job.salaryCurrency)}{' '}
              {PERIOD_LABELS[job.salaryPeriod]}. Approximate conversion to {displayCurrency}, your
              bank’s rate and fees may differ.
            </p>
          )}
          {hasPay && !salary.converted && !salary.sameCurrency && (
            <p className="field__hint">
              A current {displayCurrency} conversion is unavailable. The employer’s original
              currency is shown.
            </p>
          )}
          {hasPay && salary.converted && rates?.date && (
            <details className="salary-reference">
              <summary>About this estimate</summary>
              <p className="field__hint">
                Based on reference rates from {rates.date}. This is an estimate, not a bank quote.
                The original salary and pay period remain unchanged.
              </p>
            </details>
          )}
        </section>
        <section className="detail-section">
          <div className="section-heading">
            <h2>About this role</h2>
          </div>
          <div className="detail__text">
            {description ||
              'This source only provides a short listing. Open the employer’s page for the full responsibilities and application instructions.'}
          </div>
        </section>
        {(job.requiredSkills.length > 0 || job.usefulSkills.length > 0) && (
          <section className="detail-section">
            <h2>Skills mentioned</h2>
            <div className="taglist">
              {[...new Set([...job.requiredSkills, ...job.usefulSkills])].map((skill) => (
                <span className="tag" key={skill}>
                  {skill}
                </span>
              ))}
            </div>
          </section>
        )}
        <section className="detail-section">
          <div className="section-heading">
            <h2>Before you apply</h2>
          </div>
          <ul className="application-tips">
            <li>Read the full role description and check the location and work type.</li>
            <li>Confirm the employer and role on the employer's own website.</li>
            <li>Tailor your CV to the skills named in this listing — truthfully.</li>
            <li>Never pay anyone for a job, an interview, or an application.</li>
          </ul>
        </section>
        {profile.skills.length > 0 && (
          <details className="detail-section">
            <summary>How your preferences compare</summary>
            <ScoreBreakdown components={scored.components} />
          </details>
        )}
      </div>
      {reporting && <ReportDialog jobId={job.id} onClose={() => setReporting(false)} />}
      <LeavingWarning
        open={leaving}
        href={applyUrl || '#'}
        onContinue={() => setLeaving(false)}
        onCancel={() => setLeaving(false)}
      />
    </article>
  )
}
