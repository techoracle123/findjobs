import { Trash2 } from 'lucide-react'
import type { Job, SavedApplication } from '../shared/types'
import { formatRange } from '../shared/format'

interface SavedPanelProps {
  saved: SavedApplication[]
  jobs: Job[]
  onOpen: (jobId: string) => void
  onRemove: (jobId: string) => void
}

export function SavedPanel({ saved, jobs, onOpen, onRemove }: SavedPanelProps) {
  if (saved.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <p className="empty__title">Nothing saved yet</p>
          <p>
            Save a role from the opportunities list and it will appear here. Saved roles live in
            this browser only.
          </p>
        </div>
      </div>
    )
  }

  const byId = new Map(jobs.map((job) => [job.id, job]))

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Saved &amp; applied</h2>
        <div style={{ flex: 1 }} />
        <span className="resultcount">{saved.length}</span>
      </div>
      <div className="panel__body">
        {saved.map((entry) => {
          const job = byId.get(entry.jobId)
          return (
            <div
              className="jobrow"
              key={entry.jobId}
              style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
            >
              <span className="jobrow__main">
                <span className="jobrow__title">{job ? job.title : entry.jobId}</span>
                <span className="jobrow__company">
                  {job
                    ? `${job.company} · ${job.locationLabel}`
                    : 'This role is no longer in the feed.'}
                </span>
                <span className="jobrow__meta">
                  <span
                    className={`chip ${entry.status === 'applied' ? 'chip--ok' : 'chip--plain'}`}
                  >
                    {entry.status === 'applied' ? 'Applied' : 'Saved'}
                  </span>
                  {job && (
                    <span className="chip chip--plain">
                      {formatRange(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                    </span>
                  )}
                </span>
              </span>
              <span className="jobrow__aside">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => onOpen(entry.jobId)}
                  disabled={!job}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onRemove(entry.jobId)}
                  aria-label="Remove"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
