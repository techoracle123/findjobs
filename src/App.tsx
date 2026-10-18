import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, Bookmark, Briefcase, CreditCard, Radar, RotateCw, Search } from 'lucide-react'
import type { ApiHealth, CvSuggestion, Job, Profile, RatesPayload } from './shared/types'
import {
  fetchHealth,
  fetchJobs,
  fetchPlans,
  fetchRates,
  createTelegramLink,
  fetchTelegramStatus,
} from './lib/api'
import type { PlanDefinition } from './lib/api'
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
import { PlanPanel } from './components/PlanPanel'
import { useAccount } from './hooks/useAccount'

type Tab = 'opportunities' | 'saved' | 'alerts' | 'plan'

const TABS: { id: Tab; label: string; icon: typeof Radar }[] = [
  { id: 'opportunities', label: 'Opportunities', icon: Radar },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'plan', label: 'Plan', icon: CreditCard },
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SGD', 'BRL', 'INR', 'JPY', 'NGN']

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [rates, setRates] = useState<RatesPayload | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [plans, setPlans] = useState<PlanDefinition[]>([])
  const [dataNote, setDataNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [displayCurrency, setDisplayCurrency] = useState<string>(() =>
    readLocal<string>('currency', 'USD'),
  )

  const account = useAccount()
  const { profile, saved, alerts, setProfile, setSaved, setAlerts } = account

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
      const [jobsResponse, ratesResponse, healthResponse, planResponse] = await Promise.all([
        fetchJobs(),
        fetchRates(),
        fetchHealth(),
        fetchPlans(),
      ])
      setJobs(jobsResponse.jobs)
      setDataNote(jobsResponse.warning ?? null)
      setRates(ratesResponse)
      setHealth(healthResponse)
      setPlans(planResponse.plans)
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (account.mode !== 'signed-in') return
    void fetchTelegramStatus()
      .then((status) => setTelegramLinked(status.linked))
      .catch(() => setTelegramLinked(false))
  }, [account.mode])

  const requireSignIn = () => {
    const url = health?.accessLoginUrl
    if (url) {
      window.location.href = url
      return
    }
    setToast('Sign-in is not configured on this deployment.')
  }

  const linkTelegram = async () => {
    try {
      const { url } = await createTelegramLink()
      window.open(url, '_blank', 'noopener')
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

  const selected = useMemo(
    () => scored.find((entry) => entry.job.id === selectedId) ?? null,
    [scored, selectedId],
  )

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

  const demoCount = jobs.filter((job) => job.isDemo).length

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand__mark" />
          Role Signal
          <span className="brand__sub">Opportunity desk</span>
        </span>

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          {health && (
            <>
              <span className="chip chip--plain" title="Application mode">
                {health.appMode}
              </span>
              <span
                className={`chip ${health.aiBinding ? 'chip--ok' : 'chip--plain'}`}
                title="Workers AI binding"
              >
                AI {health.aiBinding ? 'on' : 'off'}
              </span>
              <span
                className={`chip ${health.telegramConfigured ? 'chip--ok' : 'chip--plain'}`}
                title="Telegram bot"
              >
                Telegram {health.telegramConfigured ? 'on' : 'off'}
              </span>
              <span className="chip chip--plain" title="Data source">
                {health.dataSource === 'd1' ? 'D1' : 'bundled demo'}
              </span>
            </>
          )}

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

        <main className="content">
          {demoCount > 0 && (
            <div className="banner banner--demo">
              <Briefcase size={15} />
              <span>
                <strong>Preview dataset.</strong> These {demoCount} roles are fictional and sit on a
                fictional board. They are not live vacancies and must not be presented as such.
              </span>
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
                The API could not be reached: {loadError}. Start it with{' '}
                <code>npm run dev:api</code>.
              </span>
            </div>
          )}

          <nav className="tabs" role="tablist">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === id}
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
                  {sorted.jobs.length} of {jobs.length}
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
                  {sorted.jobs.length === 0 ? (
                    <div className="empty">
                      <p className="empty__title">No roles match</p>
                      <p>
                        {jobs.length === 0
                          ? 'The feed is empty. Check that the API is running.'
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
                        onSelect={() => setSelectedId(entry.job.id)}
                      />
                    ))
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
              jobs={jobs}
              onOpen={(jobId) => {
                setSelectedId(jobId)
                setTab('opportunities')
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
              onLinkTelegram={() => void linkTelegram()}
              onRequireSignIn={requireSignIn}
            />
          )}

          {tab === 'plan' && (
            <PlanPanel
              signedIn={account.mode === 'signed-in'}
              billingEnabled={Boolean(health?.billingConfigured)}
              plans={plans}
              subscription={account.subscription}
              entitlements={account.entitlements}
              onRefresh={account.refresh}
              onRequireSignIn={requireSignIn}
            />
          )}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
