import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bookmark,
  Radar,
  RotateCw,
  Search,
  SlidersHorizontal,
  UserRound,
} from 'lucide-react'
import type { ApiHealth, CvSuggestion, Job, Profile, RatesPayload } from './shared/types'
import {
  fetchHealth,
  fetchJobs,
  fetchJob,
  fetchRates,
  createTelegramLink,
  fetchTelegramStatus,
} from './lib/api'
import { readLocal, writeLocal } from './lib/storage'
import { DEFAULT_FILTERS, filterJobs, salaryView, sortJobs } from './lib/ranking'
import type { SortKey } from './lib/ranking'
import { scoreJob } from './shared/scoring'
import { ProfilePanel, EMPTY_PROFILE } from './components/ProfilePanel'
import { CvImport } from './components/CvImport'
import { FilterBar } from './components/FilterBar'
import { JobRow } from './components/JobRow'
import { JobDetail } from './components/JobDetail'
import { SavedPanel } from './components/SavedPanel'
import { AlertsPanel } from './components/AlertsPanel'
import { useAccount } from './hooks/useAccount'
import { ProgressPanel } from './components/ProgressPanel'
import { deviceActivity } from './shared/activity'
import type { JobFacets } from './server/job-stats'

type Tab = 'opportunities' | 'saved' | 'alerts' | 'progress'

const TABS: { id: Tab; label: string; icon: typeof Radar }[] = [
  { id: 'progress', label: 'Progress', icon: BarChart3 },
  { id: 'opportunities', label: 'Opportunities', icon: Radar },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'alerts', label: 'Alerts', icon: Bell },
]

const CURRENCIES = [
  'NGN',
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'CHF',
  'SGD',
  'BRL',
  'INR',
  'JPY',
  'ZAR',
  'GHS',
  'KES',
  'AED',
]

function routeJobId(): string | null {
  const match = window.location.pathname.match(/^\/jobs\/([^/]+)\/?$/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

const DISCLAIMER =
  'FJ is an information broker: we share opportunities, not job offers. We are not affiliated with employers and do not verify or endorse listings. Always verify the employer, requirements and original listing before applying. Never pay to apply.'

export default function App() {
  const [knownJobs, setKnownJobs] = useState<Record<string, Job>>({})
  const [jobs, setJobs] = useState<Job[]>([])
  const [rates, setRates] = useState<RatesPayload | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<JobFacets | null>(null)
  const [feedUpdatedAt, setFeedUpdatedAt] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [dataNote, setDataNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [displayCurrency, setDisplayCurrency] = useState<string>(() =>
    readLocal<string>('currency', 'NGN'),
  )

  const account = useAccount()
  const { profile, saved, alerts, setProfile, setSaved, setAlerts } = account

  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(() =>
    window.location.pathname === '/dashboard' ? 'progress' : 'opportunities',
  )
  const [selectedId, setSelectedId] = useState<string | null>(routeJobId)
  const [jobPage, setJobPage] = useState(() => routeJobId() !== null)
  const [jobPageError, setJobPageError] = useState<string | null>(null)
  const resultsScroll = useRef(0)
  const requestVersion = useRef(0)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [toast, setToast] = useState<string | null>(null)
  const [telegramLinked, setTelegramLinked] = useState(false)

  useEffect(() => writeLocal('currency', displayCurrency), [displayCurrency])

  const load = useCallback(
    async (force = false) => {
      const version = ++requestVersion.current
      setLoading(true)
      setLoadError(null)
      try {
        const jobsResponse = await fetchJobs(0, filters.query, filters, force)
        if (version !== requestVersion.current) return
        setJobs(jobsResponse.jobs)
        setTotal(jobsResponse.total ?? jobsResponse.jobs.length)
        setFeedUpdatedAt(jobsResponse.updatedAt || null)
        setDataNote(jobsResponse.warning ?? null)
        setFacets(jobsResponse.facets || null)
      } catch (cause) {
        if (version === requestVersion.current)
          setLoadError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }
    },
    [filters],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 300)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    let active = true
    void Promise.all([fetchRates().catch(() => null), fetchHealth().catch(() => null)]).then(
      ([rates, health]) => {
        if (active) {
          setRates(rates)
          setHealth(health)
        }
      },
    )
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [load])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const version = requestVersion.current
      const response = await fetchJobs(jobs.length, filters.query, filters)
      if (version !== requestVersion.current) return
      setJobs((current) => [
        ...current,
        ...response.jobs.filter((job) => !current.some((existing) => existing.id === job.id)),
      ])
      setTotal(response.total ?? total)
    } catch {
      setToast('We couldn’t load more jobs. Please try again.')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    const navigate = () => {
      const id = routeJobId()
      setSelectedId(id)
      setJobPage(Boolean(id))
      setJobPageError(null)
      window.requestAnimationFrame(() => window.scrollTo(0, id ? 0 : resultsScroll.current))
    }
    window.addEventListener('popstate', navigate)
    return () => {
      window.history.scrollRestoration = previous
      window.removeEventListener('popstate', navigate)
    }
  }, [])

  const openJob = (id: string) => {
    if (!jobPage) resultsScroll.current = window.scrollY
    window.history.pushState({ fjJob: true }, '', `/jobs/${encodeURIComponent(id)}`)
    setSelectedId(id)
    setJobPage(true)
    setJobPageError(null)
    window.scrollTo(0, 0)
  }

  const backToResults = () => {
    if (window.history.state?.fjJob) {
      window.history.back()
      return
    }
    window.history.replaceState(null, '', '/')
    setJobPage(false)
    setSelectedId(null)
    window.requestAnimationFrame(() => window.scrollTo(0, resultsScroll.current))
  }

  useEffect(() => {
    if (
      !jobPage ||
      !selectedId ||
      (knownJobs[selectedId] && !knownJobs[selectedId].descriptionPreview)
    )
      return
    let cancelled = false
    void fetchJob(selectedId)
      .then((job) => {
        if (!cancelled) setKnownJobs((current) => ({ ...current, [job.id]: job }))
      })
      .catch(() => {
        if (!cancelled)
          setJobPageError('This job is unavailable. It may have been removed by the publisher.')
      })
    return () => {
      cancelled = true
    }
  }, [jobPage, selectedId, knownJobs])

  useEffect(() => {
    document.title =
      jobPage && selectedId && knownJobs[selectedId]
        ? `${knownJobs[selectedId].title} — FJ - Find Jobs`
        : 'FJ - Find Jobs'
  }, [jobPage, selectedId, knownJobs])

  useEffect(() => {
    if (account.mode !== 'signed-in') return
    const check = () =>
      void fetchTelegramStatus()
        .then((status) => setTelegramLinked(status.linked))
        .catch(() => setTelegramLinked(false))
    check()
    window.addEventListener('focus', check)
    const timer = window.setInterval(check, 15000)
    return () => {
      window.removeEventListener('focus', check)
      window.clearInterval(timer)
    }
  }, [account.mode])

  const requireSignIn = () => {
    window.location.assign(
      '/auth/login?returnTo=' +
        encodeURIComponent(jobPage ? window.location.pathname : '/dashboard'),
    )
  }

  const linkTelegram = async () => {
    try {
      const { url } = await createTelegramLink()
      window.location.assign(url)
      setToast('Open Telegram to finish linking.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const scored = useMemo(() => jobs.map((job) => scoreJob(job, profile)), [jobs, profile])

  const visible = useMemo(() => filterJobs(scored, filters), [scored, filters])

  const sorted = useMemo(
    () => sortJobs(visible, sort, rates, displayCurrency),
    [visible, sort, rates, displayCurrency],
  )

  useEffect(() => {
    setKnownJobs((current) => ({
      ...current,
      ...Object.fromEntries(
        jobs.map((job) => [
          job.id,
          current[job.id] && !current[job.id].descriptionPreview ? current[job.id] : job,
        ]),
      ),
    }))
  }, [jobs])

  useEffect(() => {
    const missing = saved.filter((entry) => !knownJobs[entry.jobId])
    if (!missing.length) return
    let cancelled = false
    void Promise.all(missing.map((entry) => fetchJob(entry.jobId).catch(() => null))).then(
      (loaded) => {
        if (!cancelled && loaded.some(Boolean))
          setKnownJobs((current) => ({
            ...current,
            ...Object.fromEntries(
              loaded.filter((job): job is Job => job !== null).map((job) => [job.id, job]),
            ),
          }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [saved, knownJobs])

  const selected = useMemo(() => {
    const job = selectedId ? knownJobs[selectedId] : null
    return job ? scoreJob(job, profile) : null
  }, [knownJobs, selectedId, profile])

  const selectedSalary = useMemo(
    () => (selected ? salaryView(selected.job, rates, displayCurrency) : null),
    [selected, rates, displayCurrency],
  )

  const savedIds = useMemo(() => new Set(saved.map((entry) => entry.jobId)), [saved])
  const appliedIds = useMemo(
    () => new Set(saved.filter((entry) => entry.status === 'applied').map((entry) => entry.jobId)),
    [saved],
  )

  const toggleSave = (jobId: string) => {
    setSaved((current) => {
      if (current.some((entry) => entry.jobId === jobId)) {
        return current.filter((entry) => entry.jobId !== jobId)
      }
      return [...current, { jobId, savedAt: new Date().toISOString(), status: 'saved' }]
    })
    setToast(savedIds.has(jobId) ? 'Removed from saved' : 'Job saved')
  }

  const markApplied = (jobId: string) => {
    setSaved((current) => {
      const existing = current.find((entry) => entry.jobId === jobId)
      if (existing) {
        return current.map((entry) =>
          entry.jobId === jobId
            ? entry.status === 'applied'
              ? entry
              : {
                  ...entry,
                  status: 'applied',
                  appliedAt: entry.appliedAt || new Date().toISOString(),
                }
            : entry,
        )
      }
      return [
        ...current,
        {
          jobId,
          savedAt: new Date().toISOString(),
          status: 'applied',
          appliedAt: new Date().toISOString(),
        },
      ]
    })
    setToast('Marked as applied')
  }

  const applySuggestion = (suggestion: CvSuggestion) => {
    setProfile((current) => ({
      ...current,
      skills: Array.from(new Set([...current.skills, ...suggestion.skills])),
      targetRoleFamilies: Array.from(
        new Set([...current.targetRoleFamilies, ...suggestion.roleFamilies]),
      ),
      targetSeniority: Array.from(
        new Set([...current.targetSeniority, ...suggestion.seniority]),
      ) as Profile['targetSeniority'],
      preferredWorkModes: Array.from(
        new Set([...current.preferredWorkModes, ...suggestion.workModes]),
      ) as Profile['preferredWorkModes'],
    }))
    setToast('Profile updated from CV suggestions')
  }

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            if (jobPage) backToResults()
          }}
        >
          <img className="brand__logo" src="/favicon.svg" alt="" width="36" height="36" />
          <span>
            FJ{' '}
            <span className="brand__separator" aria-hidden="true">
              —
            </span>{' '}
            Find Jobs
          </span>
        </a>

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          <label className="visually-hidden" htmlFor="display-currency">
            Display currency
          </label>
          <select
            id="display-currency"
            className="select"
            style={{ width: 'auto' }}
            value={displayCurrency}
            onChange={(event) => setDisplayCurrency(event.target.value)}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          {account.mode === 'signed-in' && account.user && (
            <a
              href="/auth/login?returnTo=%2Fdashboard"
              className="btn btn--ghost btn--sm account-button"
              aria-label="Your account"
              title={account.user.email}
            >
              <UserRound size={17} />
              <span className="account-email">Your account</span>
            </a>
          )}
          {account.mode === 'anonymous' && (
            <>
              <a className="btn btn--ghost btn--sm" href="/auth/login?returnTo=%2Fdashboard">
                Sign in
              </a>
              <a className="btn btn--primary btn--sm" href="/auth/signup?returnTo=%2Fdashboard">
                Sign up
              </a>
            </>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void load(true)}
            disabled={loading}
            aria-label="Reload"
          >
            {loading ? <span className="spinner" /> : <RotateCw size={14} />}
          </button>
        </div>
      </header>

      {jobPage ? (
        <main className="job-page">
          <button type="button" className="btn btn--ghost back-to-results" onClick={backToResults}>
            <ArrowLeft size={16} /> Back to results
          </button>
          {jobPageError ? (
            <div className="empty" role="alert">
              <h1>Job unavailable</h1>
              <p>{jobPageError}</p>
            </div>
          ) : !selected ? (
            <div className="empty" role="status">
              <span className="spinner" />
              <p>Opening job…</p>
            </div>
          ) : (
            <JobDetail
              key={selected.job.id}
              scored={selected}
              salary={selectedSalary}
              profile={profile}
              rates={rates}
              displayCurrency={displayCurrency}
              saved={savedIds.has(selected.job.id)}
              applied={appliedIds.has(selected.job.id)}
              onSave={() => toggleSave(selected.job.id)}
              onApply={() => markApplied(selected.job.id)}
            />
          )}
          <p className="site-disclaimer">{DISCLAIMER}</p>
        </main>
      ) : (
        <div className="workspace">
          <section className="profile-tools" data-open={preferencesOpen}>
            <button
              type="button"
              className="profile-tools__toggle"
              aria-expanded={preferencesOpen}
              onClick={() => setPreferencesOpen(!preferencesOpen)}
            >
              <SlidersHorizontal size={16} /> Your preferences & filters
            </button>
            <aside className="rail">
              <ProfilePanel
                profile={profile}
                onChange={setProfile}
                onReset={() => setProfile(EMPTY_PROFILE)}
              />
              <details className="cv-disclosure">
                <summary>Or use your CV</summary>
                <CvImport onApply={applySuggestion} />
              </details>
              <FilterBar
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(DEFAULT_FILTERS)}
                counts={facets || undefined}
              />
            </aside>
          </section>

          <main className="content">
            <div className="page-intro">
              <span className="eyebrow">FJ - Find Jobs</span>
              <h1>Welcome. Find work that fits your skills.</h1>
              <p>
                Explore opportunities in Nigeria and around the world, across professions. Add your
                skills for better matches, save what interests you, and apply through the original
                listing.
              </p>
            </div>
            <p className="site-disclaimer intro-disclaimer">{DISCLAIMER}</p>
            {account.mode === 'anonymous' && (
              <p className="local-note">
                Your profile and saved jobs stay on this device.{' '}
                {health?.accessLoginUrl && (
                  <button type="button" onClick={requireSignIn}>
                    Sign in to sync them.
                  </button>
                )}
              </p>
            )}
            {account.mode === 'signed-in' && account.hasLocalData && (
              <div className="banner banner--info">
                <span>Your jobs and preferences from before sign-in are still available.</span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    void account
                      .importLocalData()
                      .then(() => setToast('Device data merged into your account'))
                      .catch(() => setToast('Could not import device data. Please try again.'))
                  }
                >
                  Import device data
                </button>
              </div>
            )}
            {account.syncError && (
              <div className="banner banner--demo" role="alert">
                Your latest changes couldn’t sync. Please check your connection and try again.
              </div>
            )}
            {dataNote && (
              <div className="banner banner--info">
                <span>{dataNote}</span>
              </div>
            )}

            {loadError && (
              <div className="banner banner--demo">
                <span>
                  Job sources are temporarily unavailable. Your saved preferences are safe. Please
                  try again shortly.
                </span>
              </div>
            )}

            <nav className="tabs" aria-label="Your job search">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="tab"
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => setTab(id)}
                >
                  <Icon size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                  {label}
                  {id === 'saved' && saved.length > 0 && (
                    <span className="tab__count">{saved.length}</span>
                  )}
                  {id === 'alerts' && alerts.length > 0 && (
                    <span className="tab__count">{alerts.length}</span>
                  )}
                </button>
              ))}
            </nav>

            {tab === 'progress' && (
              <ProgressPanel
                signedIn={account.mode === 'signed-in'}
                activity={
                  account.mode === 'signed-in' && account.activity
                    ? account.activity
                    : deviceActivity(saved)
                }
                unavailable={
                  account.mode === 'signed-in' && (!account.activity || account.activityError)
                }
              />
            )}
            {tab === 'opportunities' && (
              <>
                <div className="toolbar">
                  <div className="toolbar__search">
                    <label className="visually-hidden" htmlFor="search">
                      Search roles
                    </label>
                    <div className="searchfield">
                      <Search size={14} className="searchfield__icon" />
                      <input
                        id="search"
                        className="input"
                        value={filters.query}
                        placeholder="Search title, company, skill…"
                        onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                      />
                    </div>
                  </div>

                  <label className="visually-hidden" htmlFor="sort">
                    Sort
                  </label>
                  <select
                    id="sort"
                    className="select"
                    style={{ width: 'auto' }}
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                  >
                    <option value="relevance">Best match</option>
                    <option value="newest">Newest first</option>
                    <option value="salary-desc">Salary, high to low</option>
                    <option value="salary-asc">Salary, low to high</option>
                  </select>

                  <div className="toolbar__spacer" />

                  <span className="resultcount">
                    {sorted.jobs.length} {sorted.jobs.length === 1 ? 'job' : 'jobs'}
                    {total > jobs.length ? ` · ${total.toLocaleString()} available` : ''}
                  </span>
                </div>

                {feedUpdatedAt && (
                  <p className="hint" style={{ margin: '8px 0 12px' }}>
                    Refreshed{' '}
                    {new Date(feedUpdatedAt).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · Updates every 12 hours
                  </p>
                )}
                {facets && (
                  <section className="market-stats" aria-label="Live listing statistics">
                    <span>
                      <strong>{facets.total.toLocaleString()}</strong> matching listings
                    </span>
                    <span>
                      <strong>{facets.remote.toLocaleString()}</strong> listed remote
                    </span>
                    <span>
                      <strong>{facets.locations}</strong> stated countries
                    </span>
                  </section>
                )}
                <details className="match-help">
                  <summary>
                    <span className="match-help__ring" aria-hidden="true" /> What does the green
                    circle mean?
                  </summary>
                  <p>
                    Add your skills and preferences to see match rings. More green means more
                    overlap with what you’ve added. It’s a guide to help you explore—not a job
                    grade, employer verification or a prediction that you’ll be hired. Open a job to
                    see which preferences match.
                  </p>
                </details>

                {sorted.mixedPeriods && (
                  <div className="banner banner--info">
                    <span>
                      These results mix pay periods. Amounts are grouped by period and never
                      annualised, so figures with different periods are not directly comparable.
                    </span>
                  </div>
                )}

                <div className="results">
                  <div className="joblist">
                    {loading ? (
                      <div className="empty" role="status">
                        <span className="spinner" />
                        <p>Finding your next opportunity…</p>
                      </div>
                    ) : sorted.jobs.length === 0 ? (
                      <div className="empty">
                        <p className="empty__title">No roles match</p>
                        <p>
                          {jobs.length === 0
                            ? 'No current openings for this search. Try another location or profession.'
                            : 'Try loosening a filter or clearing your search.'}
                        </p>
                      </div>
                    ) : (
                      sorted.jobs.map((entry) => (
                        <JobRow
                          key={entry.job.id}
                          scored={entry}
                          selected={entry.job.id === selectedId}
                          salary={salaryView(entry.job, rates, displayCurrency)}
                          onSelect={() => openJob(entry.job.id)}
                        />
                      ))
                    )}
                    {jobs.length < total && (
                      <button
                        type="button"
                        className="btn load-more"
                        disabled={loadingMore}
                        onClick={() => void loadMore()}
                      >
                        {loadingMore ? 'Loading…' : 'Load more jobs'}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}

            {tab === 'saved' && (
              <SavedPanel
                saved={saved}
                jobs={Object.values(knownJobs)}
                onOpen={openJob}
                onRemove={(jobId) =>
                  setSaved((current) => current.filter((entry) => entry.jobId !== jobId))
                }
              />
            )}

            {tab === 'alerts' && (
              <AlertsPanel
                alerts={alerts}
                telegramConfigured={Boolean(health?.telegramConfigured)}
                telegramLinked={telegramLinked}
                signedIn={account.mode === 'signed-in'}
                canDeliver={
                  account.entitlements.includes('alerts') &&
                  telegramLinked &&
                  Boolean(health?.telegramConfigured)
                }
                onChange={setAlerts}
                onLinkTelegram={linkTelegram}
                onRequireSignIn={requireSignIn}
              />
            )}
          </main>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
