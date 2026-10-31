import type { ApplicationActivity } from '../shared/activity'
import type { ApplicationStage, Job, SavedApplication } from '../shared/types'

const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  preparing: 'Preparing',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  closed: 'Closed',
}

function stageOf(entry: SavedApplication): ApplicationStage {
  return entry.stage ?? (entry.status === 'applied' ? 'applied' : 'saved')
}

export function ProgressPanel({
  activity,
  signedIn,
  unavailable,
  loading,
  saved = [],
  jobs = [],
  onOpenSaved,
  onOpenTools,
  onOpenJob,
}: {
  activity: ApplicationActivity
  signedIn: boolean
  unavailable?: boolean
  loading?: boolean
  saved?: SavedApplication[]
  jobs?: Job[]
  onOpenSaved?: () => void
  onOpenTools?: () => void
  onOpenJob?: (jobId: string) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const counts = new Map<ApplicationStage, number>()
  for (const entry of saved) counts.set(stageOf(entry), (counts.get(stageOf(entry)) ?? 0) + 1)
  const due = saved
    .filter(
      (entry) =>
        entry.followUpAt && entry.followUpAt.slice(0, 10) <= today && stageOf(entry) !== 'closed',
    )
    .sort((a, b) => Date.parse(a.followUpAt ?? '') - Date.parse(b.followUpAt ?? ''))
  const preparing = counts.get('preparing') ?? 0

  return (
    <section className="progress-panel" aria-labelledby="progress-heading">
      <div className="progress-intro">
        <span className="eyebrow">Your momentum</span>
        <h2 id="progress-heading">
          Your {new Date().toLocaleDateString(undefined, { month: 'long' })} application progress
        </h2>
        <p>
          {loading
            ? 'Checking your account…'
            : signedIn
              ? 'Private to your account.'
              : 'Kept on this device. Sign in to keep progress across devices.'}
        </p>
      </div>
      {!signedIn && !loading ? (
        <p>
          <a href="/auth/login?returnTo=%2Fdashboard">Sign in</a> or{' '}
          <a href="/auth/signup?returnTo=%2Fdashboard">create an account</a> to keep a private,
          cross-device application history.
        </p>
      ) : null}
      <div className="stat-grid">
        <div>
          <strong>{unavailable ? 'Not loaded' : activity.thisMonth}</strong>
          <span>Marked applied this month</span>
        </div>
        <div>
          <strong>{unavailable ? 'Not loaded' : activity.totalApplied}</strong>
          <span>Applications recorded</span>
        </div>
        <div>
          <strong>{unavailable ? 'Not loaded' : activity.saved}</strong>
          <span>In your shortlist</span>
        </div>
        <div>
          <strong>{due.length}</strong>
          <span>Follow-ups due</span>
        </div>
      </div>
      {unavailable ? (
        <p role="status">
          {loading
            ? 'Loading application progress…'
            : 'We could not load your account history. Please try again. We will not show zero when the data is missing.'}
        </p>
      ) : null}
      {activity.undated > 0 ? (
        <p className="field__hint">
          {activity.undated} older application records have no reliable date and are not included in
          a monthly count.
        </p>
      ) : null}

      {saved.length ? (
        <div className="progress-next">
          <h3>What needs attention next</h3>
          <div className="chiprow" aria-label="Application stages">
            {(Object.keys(STAGE_LABELS) as ApplicationStage[])
              .filter((stage) => counts.has(stage))
              .map((stage) => (
                <span className="chip chip--plain" key={stage}>
                  {STAGE_LABELS[stage]}: {counts.get(stage)}
                </span>
              ))}
          </div>
          {due.length ? (
            <>
              <p>
                {due.length} follow-up{due.length === 1 ? ' is' : 's are'} due. Start with these:
              </p>
              <ul className="plain-list">
                {due.slice(0, 3).map((entry) => {
                  const job = byId.get(entry.jobId)
                  return (
                    <li key={entry.jobId}>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => onOpenJob?.(entry.jobId)}
                      >
                        {job ? `${job.title} at ${job.company}` : 'Open saved job'}
                      </button>{' '}
                      , {STAGE_LABELS[stageOf(entry)]}, follow up {entry.followUpAt?.slice(0, 10)}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : preparing ? (
            <p>
              You are preparing {preparing} application{preparing === 1 ? '' : 's'}. Finish the
              strongest one first, then set a follow-up date after you apply.
            </p>
          ) : (
            <p>
              No follow-up is due. Review your saved jobs, prepare the strongest match, and add a
              follow-up date when you apply.
            </p>
          )}
          <div className="btnrow">
            {onOpenSaved ? (
              <button className="btn btn--primary" type="button" onClick={onOpenSaved}>
                Open saved &amp; applied
              </button>
            ) : null}
            {onOpenTools ? (
              <button className="btn" type="button" onClick={onOpenTools}>
                Open CV and match tools
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="progress-advice">
        <h3>Keep going</h3>
        <p>
          Apply for more than one job. Good applications can help, but no number can promise an
          interview or a job.
        </p>
        <ul>
          <li>
            Look at similar jobs. Your skills may fit even if the job title is not your first
            choice.
          </li>
          <li>
            Match your CV to the job. Use true examples. Check the place, the rules and the closing
            date.
          </li>
          <li>
            Apply through the original listing, then mark the role as applied here. Opening a link
            does not count as applying.
          </li>
        </ul>
      </div>
      <p className="field__hint">
        These are jobs you marked as applied. The company has not confirmed them to FJ. Removing a
        saved job does not remove your account history.
      </p>
    </section>
  )
}
