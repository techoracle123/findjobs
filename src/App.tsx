import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Bookmark, Radar, RotateCw, Search, SlidersHorizontal } from 'lucide-react'
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

type Tab = 'opportunities' | 'saved' | 'alerts'

const TABS: { id: Tab; label: string; icon: typeof Radar }[] = [
  { id: 'opportunities', label: 'Opportunities', icon: Radar },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'alerts', label: 'Alerts', icon: Bell },
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SGD', 'BRL', 'INR', 'JPY', 'NGN']

export default function App() {
  const [knownJobs, setKnownJobs] = useState<Record<string, Job>>({})
  const [jobs, setJobs] = useState<Job[]>([])
  const [rates, setRates] = useState<RatesPayload | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [dataNote, setDataNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [displayCurrency, setDisplayCurrency] = useState<string>(() =>
    readLocal<string>('currency', 'USD'),
  )

  const account = useAccount()
  const { profile, saved, alerts, setProfile, setSaved, setAlerts } = account

  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('opportunities')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [toast, setToast] = useState<string | null>(null)
  const [telegramLinked, setTelegramLinked] = useState(false)

  useEffect(() => writeLocal('currency', displayCurrency), [displayCurrency])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [jobsResponse, ratesResponse, healthResponse] = await Promise.all([
        fetchJobs(0, filters.query),
        fetchRates().catch(() => null),
        fetchHealth().catch(() => null),
      ])
      setJobs(jobsResponse.jobs)
      setTotal(jobsResponse.total ?? jobsResponse.jobs.length)
      setSelectedId((current) =>
        jobsResponse.jobs.some((job) => job.id === current)
          ? current
          : (jobsResponse.jobs[0]?.id ?? null),
      )
      setDataNote(jobsResponse.warning ?? null)
      setRates(ratesResponse)
      setHealth(healthResponse)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [filters.query])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 300)
    return () => window.clearTimeout(timer)
  }, [load])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const response = await fetchJobs(jobs.length, filters.query)
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
    const url = health?.accessLoginUrl
    if (url) {
      window.location.href = url
      return
    }
    setToast('Sign-in isn’t available right now. You can still save jobs on this device.')
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
      ...Object.fromEntries(jobs.map((job) => [job.id, job])),
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
    setToast(savedIds.has(jobId) ? 'Removed from saved' : 'Saved in this browser')
  }

  const markApplied = (jobId: string) => {
    setSaved((current) => {
      const existing = current.find((entry) => entry.jobId === jobId)
      if (existing) {
        return current.map((entry) =>
          entry.jobId === jobId
            ? { ...entry, status: 'applied', appliedAt: new Date().toISOString() }
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
    setToast('Marked as applied (local only)')
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
        <span className="brand">
          <span className="brand__mark" />
          Find Jobs
          <span className="brand__sub">Make your next move.</span>
        </span>

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
            <span className="chip chip--ok" title={`Signed in as ${account.user.email}`}>
              {account.user.email}
            </span>
          )}

          {account.mode === 'anonymous' && health?.accessLoginUrl && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={requireSignIn}>
              Sign in
            </button>
          )}

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Reload"
          >
            {loading ? <span className="spinner" /> : <RotateCw size={14} />}
          </button>
        </div>
      </header>

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
            <CvImport onApply={applySuggestion} />
            <FilterBar
              filters={filters}
              onChange={setFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
            />
          </aside>
        </section>

        <main className="content">
          <div className="page-intro">
            <span className="eyebrow">A little closer to your next chapter</span>
            <h1>Good work starts with the right opportunity.</h1>
            <p>
              Browse real openings. Add your skills to find a better fit, and keep the jobs you like
              in one place.
            </p>
          </div>
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
                We couldn’t load jobs right now. Please check your connection and try again.
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
                          ? 'New openings will appear here once they’ve been checked. Please check back shortly.'
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
                        onSelect={() => {
                          setSelectedId(entry.job.id)
                          if (window.innerWidth < 1400)
                            window.setTimeout(
                              () =>
                                document
                                  .querySelector('.detail')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                              30,
                            )
                        }}
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

                <JobDetail
                  scored={selected}
                  salary={selectedSalary}
                  rates={rates}
                  displayCurrency={displayCurrency}
                  saved={selected ? savedIds.has(selected.job.id) : false}
                  applied={selected ? appliedIds.has(selected.job.id) : false}
                  onSave={() => selected && toggleSave(selected.job.id)}
                  onApply={() => selected && markApplied(selected.job.id)}
                />
              </div>
            </>
          )}

          {tab === 'saved' && (
            <SavedPanel
              saved={saved}
              jobs={Object.values(knownJobs)}
              onOpen={(jobId) => {
                if (knownJobs[jobId]) {
                  setSelectedId(jobId)
                  setTab('opportunities')
                  return
                }
                void fetchJob(jobId)
                  .then((job) => {
                    setKnownJobs((current) => ({ ...current, [job.id]: job }))
                    setSelectedId(job.id)
                    setTab('opportunities')
                  })
                  .catch(() =>
                    setToast('This saved job is unavailable right now. Please try again later.'),
                  )
              }}
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

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
