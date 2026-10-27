import { ArrowUpRight, Bookmark, BookmarkCheck, Flag } from 'lucide-react'
import type { ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime } from '../shared/format'
import { roleFamilyLabel, workModeLabel } from '../shared/taxonomy'
import type { SalaryView } from '../lib/ranking'
import { MatchRing } from './MatchRing'

interface JobRowProps {
  scored: ScoredJob
  selected: boolean
  salary: SalaryView
  saved?: boolean
  onSelect: () => void
  onSave?: () => void
  onReport?: () => void
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

export function JobRow({
  scored,
  selected,
  salary,
  saved = false,
  onSelect,
  onSave,
  onReport,
}: JobRowProps) {
  const { job, score } = scored
  const hasProfile = scored.components.some((component) => component.applicable)
  const hasPay = salary.max > 0 || salary.min > 0
  return (
    <div className="jobrow-wrap">
      {job.moderationState === 'caution' && (
        <p className="jobrow__caution">We can’t confirm this employer yet. Never pay to apply.</p>
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
        </span>
        <span className="jobrow__aside">
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
          <ArrowUpRight size={16} aria-hidden="true" />
        </span>
      </a>
      {onReport && (
        <button
          type="button"
          className="jobrow__flag"
          style={{ top: 52 }}
          aria-label={`Report ${job.title}`}
          onClick={(event) => {
            event.preventDefault()
            onReport()
          }}
        >
          <Flag size={15} />
        </button>
      )}
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
          {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
        </button>
      )}
    </div>
  )
}
