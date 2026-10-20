import type { ApplicationActivity } from '../shared/activity'

export function ProgressPanel({
  activity,
  signedIn,
  unavailable,
}: {
  activity: ApplicationActivity
  signedIn: boolean
  unavailable?: boolean
}) {
  return (
    <section className="progress-panel" aria-labelledby="progress-heading">
      <div className="progress-intro">
        <span className="eyebrow">Your momentum</span>
        <h2 id="progress-heading">
          Your {new Date().toLocaleDateString(undefined, { month: 'long' })} application progress
        </h2>
        <p>
          {signedIn
            ? 'Private to your account.'
            : 'Kept on this device. Sign in to keep progress across devices.'}
        </p>
      </div>
      <div className="stat-grid">
        <div>
          <strong>{unavailable ? '—' : activity.thisMonth}</strong>
          <span>Marked applied this month</span>
        </div>
        <div>
          <strong>{unavailable ? '—' : activity.totalApplied}</strong>
          <span>Applications recorded</span>
        </div>
        <div>
          <strong>{activity.saved}</strong>
          <span>In your shortlist</span>
        </div>
      </div>
      {unavailable && (
        <p role="status">
          Your account’s application history could not load. Retry your account sync rather than
          treating missing data as zero.
        </p>
      )}
      {activity.undated > 0 && (
        <p className="field__hint">
          {activity.undated} older application records have no reliable date and are not included in
          a monthly count.
        </p>
      )}
      <div className="progress-advice">
        <h3>Keep going. Keep it thoughtful.</h3>
        <p>
          One application is not your whole job search. Consistent, well-prepared applications give
          you more opportunities to be considered—but no number guarantees an interview or offer.
        </p>
        <ul>
          <li>
            Explore adjacent roles where your transferable skills fit, even if the title is not your
            first choice.
          </li>
          <li>
            Tailor your CV with honest examples. Check essential qualifications, location rules and
            deadlines.
          </li>
          <li>
            Apply through the original listing, then mark the role as applied here. Opening a link
            does not count as applying.
          </li>
        </ul>
      </div>
      <p className="field__hint">
        These are applications you confirm, not employer-verified submissions. Removing a bookmark
        does not erase signed-in application history.
      </p>
    </section>
  )
}
