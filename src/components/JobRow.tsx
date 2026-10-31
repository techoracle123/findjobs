import { Bookmark, BookmarkCheck, Flag } from 'lucide-react'
import type { ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime } from '../shared/format'
import { roleFamilyLabel, workModeLabel } from '../shared/taxonomy'
import type { SalaryView } from '../lib/ranking'
import { MatchRing } from './MatchRing'
import { copy } from '../shared/copy'

interface JobRowProps {
  scored: ScoredJob
  selected: boolean
  salary: SalaryView
  saved?: boolean
  onSelect: () => void
  onSave?: () => void
  onReport?: () => void
  cautionBannerEnabled?: boolean
}

function monogram(company: string): string {
  const letters = company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return (letters || '?').toUpperCase()
}

/**
 * One job card. Title, company and meta read top-to-bottom on the left;
 * salary sits under the meta; save/report live in one compact action
 * column on the right, everything in normal flow, nothing floating.
 */
export function JobRow({
  scored,
  selected,
  salary,
  saved = false,
  onSelect,
  onSave,
  onReport,
  cautionBannerEnabled = false,
}: JobRowProps) {
  const { job, score } = scored
  const hasProfile = scored.components.some((component) => component.applicable)
  const hasPay = salary.max > 0 || salary.min > 0
  return (
    <div className="jobrow-wrap">
      {job.moderationState === 'caution' && cautionBannerEnabled && (
        <p className="jobrow__caution">{copy('trust.caution')}</p>
      )}
      <a
        href={`/jobs/${encodeURIComponent(job.id)}`}
        className="jobrow"
        aria-current={selected ? 'page' : undefined}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return
          event.preventDefault()
          onSelect()
        }}
      >
        <span className="jobrow__logo" aria-hidden="true">
          {monogram(job.company || job.title)}
        </span>
        {hasProfile && <MatchRing score={score} />}
        <span className="jobrow__main">
          <span className="jobrow__title">{job.title}</span>
          <span className="jobrow__company">
            {job.company || 'Employer not stated'}
            {job.verification === 'verified' && (
              <span className="chip chip--ok jobrow__badge">Verified</span>
            )}
            {job.locationLabel ? ` · ${job.locationLabel}` : ''}
          </span>
          <span className="jobrow__meta">
            {job.roleFamily !== 'unknown' && <span>{roleFamilyLabel(job.roleFamily)}</span>}
            {job.workMode !== 'unknown' && <span>{workModeLabel(job.workMode)}</span>}
            {job.postedAt && <span>{formatRelativeTime(job.postedAt)}</span>}
            {job.jobStatus === 'closed' && <span>Closed</span>}
          </span>
          {hasPay && (
            <span className="jobrow__salary">
              {salary.converted ? '≈ ' : ''}
              {formatRange(salary.min, salary.max, salary.currency)}
              <span>
                {' '}
                {salary.period === 'unknown'
                  ? '(period not stated)'
                  : `/${salary.period === 'year' ? 'yr' : salary.period === 'month' ? 'mo' : 'hr'}`}
              </span>
            </span>
          )}
        </span>
      </a>
      {(onSave || onReport) && (
        <span className="jobrow__actions">
          {onSave && (
            <button
              type="button"
              className="jobrow__save"
              aria-label={saved ? `Remove ${job.title} from saved` : `Save ${job.title}`}
              aria-pressed={saved}
              onClick={(event) => {
                event.preventDefault()
                onSave()
              }}
            >
              {saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
            </button>
          )}
          {onReport && (
            <button
              type="button"
              className="jobrow__flag"
              aria-label={`Report ${job.title}`}
              onClick={(event) => {
                event.preventDefault()
                onReport()
              }}
            >
              <Flag size={15} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}
