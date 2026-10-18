import { ArrowUpRight } from 'lucide-react'
import type { ScoredJob } from '../shared/types'
import { formatRange, formatRelativeTime } from '../shared/format'
import { roleFamilyLabel, workModeLabel } from '../shared/taxonomy'
import type { SalaryView } from '../lib/ranking'
import { MatchRing } from './MatchRing'

interface JobRowProps {
  scored: ScoredJob
  selected: boolean
  salary: SalaryView
  onSelect: () => void
}

export function JobRow({ scored, selected, salary, onSelect }: JobRowProps) {
  const { job, score } = scored
  const hasProfile = scored.components.some((component) => component.applicable)
  const hasPay = salary.max > 0 || salary.min > 0
  return (
    <a
      href={`/jobs/${encodeURIComponent(job.id)}`}
      className="jobrow"
      aria-current={selected ? 'page' : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return
        event.preventDefault()
        onSelect()
      }}
    >
      {hasProfile && <MatchRing score={score} />}
      <span className="jobrow__main">
        <span className="jobrow__title">{job.title}</span>
        <span className="jobrow__company">
          {job.company || 'Employer not stated'} · {job.locationLabel}
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
            {hasPay && (
              <span>
                {' '}
                {salary.period === 'unknown'
                  ? ' (period not stated)'
                  : ` /${salary.period === 'year' ? 'yr' : salary.period === 'month' ? 'mo' : 'hr'}`}
              </span>
            )}
          </span>
        )}
        <ArrowUpRight size={16} aria-hidden="true" />
      </span>
    </a>
  )
}
