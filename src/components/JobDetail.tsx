import { useState } from 'react'
import { Bookmark, BookmarkCheck, ExternalLink, Flag, Send } from 'lucide-react'
import type { Job, Profile, ProTrialState, RatesPayload, ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime, PERIOD_LABELS } from '../shared/format'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'
import { applyLinkOf, isClosed } from '../shared/verification'
import { opportunityBadge, opportunityOf } from '../shared/opportunities'
import { gigCategoryFor } from '../shared/gig-categories'
import { ScoreBreakdown } from './ScoreBreakdown'
import { recordApplyClick } from '../lib/api'
import { copy } from '../shared/copy'
import { ReportDialog } from './ReportDialog'
import { LeavingWarning } from './LeavingWarning'
import { ProTools } from './ProTools'
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
  cautionBannerEnabled?: boolean
  proEnabled?: boolean
  trial?: ProTrialState
  onRefreshAccount?: () => Promise<void> | void
  onOpenJob?: (job: Job) => void
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
  proEnabled = false,
  trial,
  onRefreshAccount,
  onOpenJob,
  cautionBannerEnabled = false,
}: JobDetailProps) {
  const [reporting, setReporting] = useState(false)
  const [leaving, setLeaving] = useState(false)

  if (!scored || !salary) return null
  const { job } = scored
  const closed = isClosed(job)
  const applyUrl = applyLinkOf(job)
  const hasPay = job.salaryMin > 0 || job.salaryMax > 0
  const opportunity = opportunityOf(job)
  const isGig = opportunity.opportunityType === 'gig'
  const gigCategory = isGig ? gigCategoryFor(job) : null
  const badge = opportunityBadge(job)
  const gigFacts: Array<[string, string]> = isGig
    ? (
        [
          gigCategory ? ['Type of work', gigCategory.label] : null,
          ['Engagement', opportunity.engagementLabel || 'Gig or contract'],
          opportunity.projectDuration ? ['Stated duration', opportunity.projectDuration] : null,
          hasPay
            ? [
                'Stated pay',
                `${formatRange(job.salaryMin, job.salaryMax, job.salaryCurrency)} ${PERIOD_LABELS[job.salaryPeriod]}`,
              ]
            : ['Stated pay', 'Not stated in this advert'],
          job.workMode !== 'unknown' ? ['Work setting', workModeLabel(job.workMode)] : null,
          job.locationLabel ? ['Location', job.locationLabel] : null,
          job.requiredSkills.length || job.usefulSkills.length
            ? [
                'Main skills',
                [...new Set([...job.requiredSkills, ...job.usefulSkills])].slice(0, 4).join(', '),
              ]
            : null,
        ] as Array<[string, string] | null>
      ).filter((fact): fact is [string, string] => fact !== null)
    : []
  const applyLabel = isGig
    ? opportunity.engagementType === 'contract' || opportunity.engagementType === 'temporary'
      ? 'Apply for this contract'
      : 'Apply for this gig'
    : 'Apply for this role'
  const description = job.descriptionPreview ? 'Loading the full listing…' : job.description

  return (
    <article className="detail">
      <header className="detail__head">
        <p className="eyebrow">
          {job.company || (isGig ? 'Client or company not stated' : 'Employer not stated')}
        </p>
        <h1 className="detail__title">{job.title}</h1>
        <p className="detail__company">
          {job.locationLabel}
          {job.workMode !== 'unknown' ? ` · ${workModeLabel(job.workMode)}` : ''}
        </p>
        <div className="job-facts">
          {badge && <span className={isGig ? 'chip chip--gig' : 'chip'}>{badge}</span>}
          {gigCategory ? (
            <span>{gigCategory.label}</span>
          ) : job.roleFamily !== 'unknown' ? (
            <span>{roleFamilyLabel(job.roleFamily)}</span>
          ) : null}
          {job.seniority !== 'unknown' && <span>{seniorityLabel(job.seniority)}</span>}
          {job.sourceName && <span>Source: {job.sourceName}</span>}
          {job.postedAt && <span>Posted {formatRelativeTime(job.postedAt)}</span>}
        </div>
        {closed && (
          <p className="banner banner--info">
            This listing has closed. It is kept here for your saved-job records.
          </p>
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
          {!closed && applyUrl && (
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
              {applyLabel} <ExternalLink size={14} />
            </a>
          )}
          {!closed && !applyUrl && (
            <p className="field__hint">
              FJ cannot submit this application for you. Open the original post from the source link
              below and apply there.
            </p>
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
            <Flag size={14} /> Report this listing
          </button>
        </div>
      </header>
      <div className="detail__body">
        {isGig && (
          <section className="detail-section gig-glance" aria-labelledby="gig-glance-title">
            <h2 id="gig-glance-title">Gig at a glance</h2>
            <dl className="gig-glance__grid">
              {gigFacts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {(!opportunity.projectDuration || !hasPay) && (
              <p className="field__hint">
                If duration or pay is missing, confirm it in writing before you start work.
              </p>
            )}
          </section>
        )}
        <section className="detail-section">
          <h2>{isGig ? 'Pay' : 'Salary'}</h2>
          <p className="salary-figure">
            {salary.converted ? '≈ ' : ''}
            {formatRange(salary.min, salary.max, salary.currency)}
            {hasPay ? ` ${PERIOD_LABELS[salary.period]}` : ''}
          </p>
          {isGig && hasPay && job.salaryPeriod === 'project' && (
            <p className="field__hint">
              This is the stated project amount. Confirm what work it covers, how many revisions it
              includes, and when each payment is released before you start.
            </p>
          )}
          {isGig && hasPay && job.salaryPeriod !== 'project' && (
            <p className="field__hint">
              Confirm the expected hours, contract length, payment dates and who pays transfer or
              platform fees before you start.
            </p>
          )}
          {isGig && !hasPay && (
            <p className="field__hint">
              Pay is not stated. Ask for the rate or project amount and payment schedule in writing
              before doing sample work or starting the project.
            </p>
          )}
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
            <h2>{isGig ? 'About this gig or contract' : 'About this role'}</h2>
          </div>
          <div className="detail__text">
            {description ||
              'This source only provides a short listing. Open the original listing for the full work details and application instructions.'}
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
        <section className="detail-section original-listing">
          <h2>Original listing</h2>
          <p>
            This listing came from {job.sourceName || 'the publisher named on the original post'}.
            FJ does not verify or endorse the employer or client. Check the details independently
            before you apply.
          </p>
          {job.sourceUrl && (
            <p>
              <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">
                Open the original listing {job.sourceName ? `at ${job.sourceName}` : ''}{' '}
                <ExternalLink size={13} />
              </a>
            </p>
          )}
          {job.sourceName?.toLowerCase().includes('himalayas') && (
            <p>
              Listing from{' '}
              <a href="https://himalayas.app" target="_blank" rel="noopener noreferrer">
                Himalayas
              </a>
              . Use the apply button above to continue on the linked application page.
            </p>
          )}
          {job.sourceName?.toLowerCase().includes('remotejobs.org') && (
            <p>
              Powered by{' '}
              <a href="https://remotejobs.org" target="_blank" rel="noopener noreferrer">
                RemoteJobs.org
              </a>
              . Use the apply button above to continue on the linked application page.
            </p>
          )}
        </section>
        <ProTools
          key={job.id}
          job={job}
          proEnabled={proEnabled}
          trial={trial}
          onRefresh={onRefreshAccount}
          onOpenJob={onOpenJob}
        />
        <section className="detail-section">
          <div className="section-heading">
            <h2>Before you apply</h2>
          </div>
          {isGig ? (
            <ul className="application-tips">
              <li>Read the full advert and check the scope, deadline and expected result.</li>
              <li>
                Confirm price or rate, milestones, revisions, payment dates and who owns the
                finished work in writing.
              </li>
              <li>
                Check the client independently. Be careful with free sample work that looks like a
                real paid task.
              </li>
              <li>Never pay anyone to get a gig, contract, interview or application.</li>
            </ul>
          ) : (
            <ul className="application-tips">
              <li>Read the full role description and check the location and work setting.</li>
              <li>Confirm the employer and role on the employer's own website.</li>
              <li>Use the skills in this advert in your CV if they are true for you.</li>
              <li>Never pay anyone for a job, an interview, or an application.</li>
            </ul>
          )}
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
