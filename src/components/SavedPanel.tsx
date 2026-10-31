import { CalendarClock, Trash2 } from 'lucide-react'
import type { ApplicationStage, Job, ProTrialState, SavedApplication } from '../shared/types'
import { formatRange } from '../shared/format'

interface SavedPanelProps {
  saved: SavedApplication[]
  jobs: Job[]
  proEnabled: boolean
  trial: ProTrialState
  onOpen: (jobId: string) => void
  onRemove: (jobId: string) => void
  onUpdate: (entry: SavedApplication) => void
  onOpenPlan: () => void
}

const STAGES: Array<{ value: ApplicationStage; label: string; pro?: boolean }> = [
  { value: 'saved', label: 'Saved' },
  { value: 'preparing', label: 'Preparing application', pro: true },
  { value: 'applied', label: 'Applied' },
  { value: 'interview', label: 'Interview stage', pro: true },
  { value: 'offer', label: 'Offer received', pro: true },
  { value: 'closed', label: 'Closed / no longer pursuing', pro: true },
]

function stageOf(entry: SavedApplication): ApplicationStage {
  return entry.stage ?? (entry.status === 'applied' ? 'applied' : 'saved')
}

function dateValue(value?: string): string {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''
}

export function SavedPanel({
  saved,
  jobs,
  proEnabled,
  trial,
  onOpen,
  onRemove,
  onUpdate,
  onOpenPlan,
}: SavedPanelProps) {
  if (saved.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          <p className="empty__title">Nothing saved yet</p>
          <p>
            Save a job you like and come back to it here. Sign in to keep your list across devices.
          </p>
        </div>
      </div>
    )
  }

  const byId = new Map(jobs.map((job) => [job.id, job]))
  const today = new Date().toISOString().slice(0, 10)
  const due = saved.filter(
    (entry) =>
      entry.followUpAt && dateValue(entry.followUpAt) <= today && stageOf(entry) !== 'closed',
  )
  const sorted = [...saved].sort((a, b) => {
    const aDue = a.followUpAt ? Date.parse(a.followUpAt) : Number.POSITIVE_INFINITY
    const bDue = b.followUpAt ? Date.parse(b.followUpAt) : Number.POSITIVE_INFINITY
    return (
      aDue - bDue || Date.parse(b.appliedAt ?? b.savedAt) - Date.parse(a.appliedAt ?? a.savedAt)
    )
  })

  const updateStage = (entry: SavedApplication, stage: ApplicationStage) => {
    onUpdate({
      ...entry,
      stage,
      status: ['applied', 'interview', 'offer', 'closed'].includes(stage) ? 'applied' : 'saved',
    })
  }

  return (
    <div className="panel saved-panel">
      <div className="panel__head">
        <div>
          <p className="eyebrow">Your shortlist</p>
          <h2 className="panel__title">Saved &amp; applied</h2>
        </div>
        <div style={{ flex: 1 }} />
        <span className="resultcount">{saved.length}</span>
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          Saving jobs and marking them as applied is free. Pro adds more stages and follow up dates.
        </p>
        {due.length ? (
          <p className="banner banner--info" role="status">
            <CalendarClock size={15} /> {due.length} follow-up{due.length === 1 ? '' : 's'} due by
            today. They are shown first below.
          </p>
        ) : null}
        {!proEnabled ? (
          <div className="locked-box compact">
            <p>
              Want more stages? The free trial and Pro add preparing, interview, offer and closed.
              Your saved jobs will stay here.
            </p>
            <button className="btn btn--sm" type="button" onClick={onOpenPlan}>
              {trial.status === 'not_started' ? 'Start free trial' : 'See Pro plans'}
            </button>
          </div>
        ) : null}

        {sorted.map((entry) => {
          const job = byId.get(entry.jobId)
          const stage = stageOf(entry)
          const isDue = Boolean(
            entry.followUpAt && dateValue(entry.followUpAt) <= today && stage !== 'closed',
          )
          return (
            <article className={`saved-card ${isDue ? 'saved-card-due' : ''}`} key={entry.jobId}>
              <div className="saved-card-head">
                <div>
                  <h3>{job ? job.title : 'Saved job'}</h3>
                  <p className="muted">
                    {job
                      ? `${job.company} · ${job.locationLabel}`
                      : 'Open this saved job to check its latest details.'}
                  </p>
                  <div className="chiprow">
                    <span className={`chip ${stage !== 'saved' ? 'chip--ok' : 'chip--plain'}`}>
                      {STAGES.find((item) => item.value === stage)?.label ?? stage}
                    </span>
                    {entry.followUpAt ? (
                      <span className={`chip ${isDue ? 'chip--warn' : 'chip--plain'}`}>
                        Follow up {dateValue(entry.followUpAt)}
                      </span>
                    ) : null}
                    {job ? (
                      <span className="chip chip--plain">
                        {formatRange(job.salaryMin, job.salaryMax, job.salaryCurrency)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="btnrow">
                  <button type="button" className="btn btn--sm" onClick={() => onOpen(entry.jobId)}>
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onRemove(entry.jobId)}
                    aria-label={`Remove ${job?.title ?? 'saved job'}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="saved-controls">
                <label className="field">
                  Stage
                  <select
                    value={stage}
                    onChange={(event) => updateStage(entry, event.target.value as ApplicationStage)}
                  >
                    {STAGES.map((item) => (
                      <option
                        key={item.value}
                        value={item.value}
                        disabled={Boolean(item.pro && !proEnabled && item.value !== stage)}
                      >
                        {item.label}
                        {item.pro && !proEnabled ? ' (Pro)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Follow-up date {proEnabled ? '' : '(Pro)'}
                  <input
                    type="date"
                    value={dateValue(entry.followUpAt)}
                    disabled={!proEnabled}
                    onChange={(event) =>
                      onUpdate({
                        ...entry,
                        followUpAt: event.target.value
                          ? new Date(`${event.target.value}T12:00:00`).toISOString()
                          : undefined,
                      })
                    }
                  />
                </label>
              </div>
              <details>
                <summary>Private note</summary>
                <label className="field">
                  Note for this job
                  <textarea
                    rows={3}
                    defaultValue={entry.note ?? ''}
                    placeholder="Contact name, what you sent, or what to ask next"
                    onBlur={(event) =>
                      onUpdate({
                        ...entry,
                        note: event.target.value.trim() || undefined,
                      })
                    }
                  />
                </label>
              </details>
            </article>
          )
        })}
      </div>
    </div>
  )
}
