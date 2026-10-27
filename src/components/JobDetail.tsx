import { useEffect, useState } from 'react'
import {
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Flag,
  LoaderCircle,
  Send,
  Sparkles,
} from 'lucide-react'
import type { JobAdvice, JobTranslation, Profile, RatesPayload, ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime, PERIOD_LABELS } from '../shared/format'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'
import { applyLinkOf, isClosed } from '../shared/verification'
import { ScoreBreakdown } from './ScoreBreakdown'
import { jobAdvice, recordApplyClick, translateJob } from '../lib/api'
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
  const [translation, setTranslation] = useState<JobTranslation | null>(null)
  const [original, setOriginal] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const [advice, setAdvice] = useState<JobAdvice | null>(null)
  const [advising, setAdvising] = useState(false)
  const [adviceError, setAdviceError] = useState<string | null>(null)
  const id = scored?.job.id

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setTranslating(true)
    void translateJob(id)
      .then((result) => {
        if (!cancelled) setTranslation(result)
      })
      .catch(() => {
        if (!cancelled)
          setTranslationError(
            'Translation is unavailable right now. The original description is shown.',
          )
      })
      .finally(() => {
        if (!cancelled) setTranslating(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!scored || !salary) return null
  const { job } = scored
  const closed = isClosed(job)
  const applyUrl = applyLinkOf(job)
  const hasPay = job.salaryMin > 0 || job.salaryMax > 0
  const description =
    !original && translation?.translated
      ? translation.description
      : job.descriptionPreview
        ? 'Loading the full listing…'
        : job.description
  const sourceName = job.sourceName
    .replace(/\s*(?:Job Board )?API\b/gi, '')
    .split('—')[0]
    .trim()

  const requestAdvice = async () => {
    setAdvising(true)
    setAdviceError(null)
    try {
      setAdvice(await jobAdvice(job.id, profile.skills))
    } catch {
      setAdviceError(copy('advice.failed'))
    } finally {
      setAdvising(false)
    }
  }
  const retryTranslation = async () => {
    setTranslating(true)
    setTranslationError(null)
    try {
      setTranslation(await translateJob(job.id))
    } catch {
      setTranslationError(copy('translation.failed'))
    } finally {
      setTranslating(false)
    }
  }

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
              Open original listing <ExternalLink size={13} />
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
            {translation?.translated && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setOriginal(!original)}
              >
                {original ? 'Read in English' : 'View original'}
              </button>
            )}
          </div>
          {translating && (
            <p className="field__hint" role="status">
              Preparing the English description…
            </p>
          )}
          {translation?.translated && !original && (
            <p className="field__hint">
              AI-translated into English. Check the original wording for important details.
            </p>
          )}
          {(translation?.message || translationError) && (
            <p className="field__hint">
              {translationError || translation?.message}{' '}
              <button
                type="button"
                className="text-button"
                disabled={translating}
                onClick={() => void retryTranslation()}
              >
                Retry translation
              </button>
            </p>
          )}
          <div className="detail__text">
            {description ||
              'This source only provides a short listing. Open the original listing for the full responsibilities and application instructions.'}
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
            <h2>Make your application count</h2>
            <Sparkles size={17} />
          </div>
          <p className="field__hint">
            Get advice tailored to this listing
            {profile.skills.length ? ' and your listed skills' : ''}. Requesting advice sends the
            job text and your skills, not your CV, to our AI provider. Suggestions are not employer
            requirements or a guarantee.
          </p>
          <button
            type="button"
            className="btn"
            disabled={advising}
            onClick={() => void requestAdvice()}
          >
            {advising ? <LoaderCircle size={14} className="icon-spin" /> : <Sparkles size={14} />}
            {advising
              ? 'Preparing advice…'
              : advice
                ? 'Refresh application tips'
                : 'Get application tips'}
          </button>
          {adviceError && (
            <p role="alert" className="field__hint">
              {adviceError}
            </p>
          )}
          {advice && (
            <>
              <ol className="application-tips">
                {advice.tips.map((tip) => (
                  <li key={tip.title}>
                    <h3>{tip.title}</h3>
                    <p>{tip.text}</p>
                  </li>
                ))}
              </ol>
              <p className="field__hint">
                {advice.message ||
                  'AI-generated advice. Review it and only include truthful experience in your application.'}
              </p>
            </>
          )}
        </section>
        {profile.skills.length > 0 && (
          <details className="detail-section">
            <summary>How your preferences compare</summary>
            <ScoreBreakdown components={scored.components} />
          </details>
        )}
        <footer className="original-listing">
          <a href={job.sourceUrl || applyUrl || '#'} target="_blank" rel="noopener noreferrer">
            Original listing{sourceName ? ` · ${sourceName}` : ''} <ExternalLink size={12} />
          </a>
        </footer>
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
