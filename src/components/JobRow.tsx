import { Clock, ExternalLink, MapPin } from 'lucide-react'
import type { ScoredJob } from '../shared/types'
import { ELIGIBILITY_LABELS } from '../shared/scoring'
import { formatRange, formatRelativeTime, freshnessOf, FRESHNESS_LABELS } from '../shared/format'
import { roleFamilyLabel, seniorityLabel, workModeLabel } from '../shared/taxonomy'
import type { SalaryView } from '../lib/ranking'

interface JobRowProps {
  scored: ScoredJob
  selected: boolean
  salary: SalaryView
  onSelect: () => void
}

const TIER_CLASS: Record<string, string> = {
  eligible: 'chip--ok',
  unknown: 'chip--warn',
  restricted: 'chip--danger',
}

export function JobRow({ scored, selected, salary, onSelect }: JobRowProps) {
  const { job, score, tier } = scored
  const freshness = freshnessOf(job.postedAt)
  const hasProfile = scored.components.some((component) => component.applicable)

  return (
    <button type="button" className="jobrow" aria-current={selected} onClick={onSelect}>
      <span
        className={`scorebadge${hasProfile ? '' : ' scorebadge--muted'}`}
        style={{ '--pct': score } as React.CSSProperties}
        title={
          hasProfile ? `${score} / 100 match` : 'Add skills to your profile to see a match score'
        }
      >
        <span className="scorebadge__inner">{score}</span>
      </span>

      <span className="jobrow__main">
        <span className="jobrow__title">{job.title}</span>
        <span className="jobrow__company">
          {job.company} · {job.locationLabel}
        </span>
        <span className="jobrow__meta">
          <span className="chip chip--plain">{roleFamilyLabel(job.roleFamily)}</span>
          <span className="chip chip--plain">{seniorityLabel(job.seniority)}</span>
          <span className="chip chip--plain">{workModeLabel(job.workMode)}</span>
          <span className={`chip ${TIER_CLASS[tier]}`}>{ELIGIBILITY_LABELS[tier]}</span>
        </span>
      </span>

      <span className="jobrow__aside">
        <span className="jobrow__salary">
          {formatRange(salary.min, salary.max, salary.currency)}
          <span>
            {' '}
            {salary.period === 'year' ? '/yr' : salary.period === 'month' ? '/mo' : '/hr'}
          </span>
        </span>
        <span
          className="chip chip--plain"
          title={`${FRESHNESS_LABELS[freshness]} — posted ${formatRelativeTime(job.postedAt)}`}
        >
          <Clock size={11} />
          {formatRelativeTime(job.postedAt)}
        </span>
        <span
          className="field__hint"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <MapPin size={11} />
          {job.locationCountry}
        </span>
        <span
          className="field__hint"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <ExternalLink size={11} />
          {job.sourceName.split('—')[0].trim()}
        </span>
      </span>
    </button>
  )
}
