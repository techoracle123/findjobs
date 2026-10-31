import { useEffect, useState } from 'react'
import { ArrowRight, ListChecks } from 'lucide-react'
import { fetchBestMatches, fetchSkillPlan } from '../lib/api'
import type { BestMatch, Job, ProTrialState, SkillPlanResult } from '../shared/types'

interface ProInsightsPanelProps {
  proEnabled: boolean
  trial: ProTrialState
  onOpenPlan: () => void
  onOpenProfile: () => void
  onOpenJob: (job: Job) => void
}

type BestResponse = Awaited<ReturnType<typeof fetchBestMatches>>

function salaryLine(job: Job): string {
  if (!(job.salaryMin > 0 || job.salaryMax > 0)) return 'Pay not stated'
  const amount = (value: number) => value.toLocaleString('en-NG')
  if (job.salaryMin > 0 && job.salaryMax > job.salaryMin)
    return `${job.salaryCurrency} ${amount(job.salaryMin)} to ${amount(job.salaryMax)} / ${job.salaryPeriod}`
  return `${job.salaryCurrency} ${amount(job.salaryMax || job.salaryMin)} / ${job.salaryPeriod}`
}

function MatchCard({ match, onOpenJob }: { match: BestMatch; onOpenJob: (job: Job) => void }) {
  return (
    <article className="best-match-card">
      <div className="inline-head">
        <div>
          <h3>{match.job.title}</h3>
          <p className="muted">
            {match.job.company} · {match.job.locationLabel}
          </p>
        </div>
        <span className="status-pill status-open">Fit score {match.score}/100</span>
      </div>
      <p className="muted">{salaryLine(match.job)}</p>
      <ul className="plain-list">
        {match.reasons.slice(0, 4).map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {match.matchedSkills.length ? (
        <p>
          <strong>Your evidence:</strong> {match.matchedSkills.join(', ')}
        </p>
      ) : null}
      {match.missingSkills.length ? (
        <p>
          <strong>Not shown yet:</strong> {match.missingSkills.join(', ')}
        </p>
      ) : null}
      <button
        className="btn btn--primary btn--sm"
        type="button"
        onClick={() => onOpenJob(match.job)}
      >
        View and prepare <ArrowRight size={14} />
      </button>
    </article>
  )
}

export function ProInsightsPanel({
  proEnabled,
  trial,
  onOpenPlan,
  onOpenProfile,
  onOpenJob,
}: ProInsightsPanelProps) {
  const [best, setBest] = useState<BestResponse | null>(null)
  const [plan, setPlan] = useState<SkillPlanResult | null>(null)
  const [busy, setBusy] = useState<'best' | 'plan' | null>(null)
  const [error, setError] = useState('')

  const loadBest = async () => {
    setBusy('best')
    setError('')
    try {
      setBest(await fetchBestMatches(12))
    } catch {
      setError('We could not load your best matches. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const loadPlan = async () => {
    setBusy('plan')
    setError('')
    try {
      setPlan((await fetchSkillPlan()).plan)
    } catch {
      setError('We could not load the skills list. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (proEnabled) void loadBest()
  }, [proEnabled])

  return (
    <section className="panel" aria-labelledby="pro-insights-heading">
      <div className="panel__head panel-head-row">
        <div>
          <p className="eyebrow">Pro</p>
          <h2 className="panel__title" id="pro-insights-heading">
            Best matches and skills to learn
          </h2>
        </div>
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          See the jobs that fit you best. Then see which skills keep coming up so you know what to
          learn next.
        </p>

        {!proEnabled ? (
          <div className="locked-box">
            <h3>Start with jobs that fit you</h3>
            <p>
              Pro checks the job list against your profile and saved CV. It shows your best matches
              and the skills you may need to learn.
            </p>
            <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
              {trial.status === 'not_started' ? 'Try it free for 3 days' : 'See Pro plans'}
            </button>
          </div>
        ) : (
          <>
            <div className="btnrow">
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy === 'best'}
                onClick={() => void loadBest()}
              >
                {busy === 'best' ? 'Refreshing…' : 'Refresh best matches'}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy === 'plan'}
                onClick={() => void loadPlan()}
              >
                <ListChecks size={15} /> {busy === 'plan' ? 'Working...' : 'Show skills to learn'}
              </button>
            </div>
            {error ? (
              <p className="banner banner--demo" role="alert">
                {error}
              </p>
            ) : null}

            {best ? (
              <div className="stack">
                <p className="muted" role="status">
                  {best.message} {best.totalJobs.toLocaleString()} current jobs checked.
                </p>
                {!best.available ? (
                  <button className="btn btn--primary" type="button" onClick={onOpenProfile}>
                    Complete your profile
                  </button>
                ) : best.matches.length ? (
                  <div className="best-match-grid">
                    {best.matches.map((match) => (
                      <MatchCard key={match.job.id} match={match} onOpenJob={onOpenJob} />
                    ))}
                  </div>
                ) : (
                  <p>
                    No current job reaches a useful fit yet. Widen your target roles or add more
                    skills.
                  </p>
                )}
              </div>
            ) : busy === 'best' ? (
              <p role="status">Ranking current jobs against your profile…</p>
            ) : null}

            {plan ? (
              <div className="skill-plan stack">
                <h3>Skills to learn</h3>
                <p>{plan.message}</p>
                <p className="muted">
                  Based on {plan.sampleJobs} current jobs that fit your search.
                </p>
                {plan.items.length ? (
                  <div className="week-grid">
                    {[1, 2, 3, 4].map((week) => {
                      const items = plan.items.filter((item) => item.week === week)
                      if (!items.length) return null
                      return (
                        <article key={week}>
                          <h4>Week {week}</h4>
                          {items.map((item) => (
                            <div className="skill-gap-item" key={item.skill}>
                              <div className="inline-head">
                                <strong>{item.skill}</strong>
                                <span className="status-pill">{item.advertsAsking} adverts</span>
                              </div>
                              <p>{item.action}</p>
                              <p>
                                <strong>Work to show:</strong> {item.proofToBuild}
                              </p>
                            </div>
                          ))}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p>No skill came up again and again in these jobs.</p>
                )}
                <p className="field__hint">
                  Add a skill to your CV only when you can show real work, training or a project
                  that proves it.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
