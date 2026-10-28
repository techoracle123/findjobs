import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, Bell, Bookmark, CreditCard, RotateCw, UserRound } from 'lucide-react'
import type { ApiHealth, CvSuggestion, Job, Profile, RatesPayload } from './shared/types'
import type { ApplyQuota, PlanCatalogue, PlanDefinition } from './lib/api'
import { PlanPanel } from './components/PlanPanel'
import {
  fetchHealth,
  fetchJobs,
  fetchJob,
  fetchRates,
  fetchApplyQuota,
  fastApply,
  fetchPlans,
  createTelegramLink,
  fetchTelegramStatus,
} from './lib/api'
import { readLocal, writeLocal } from './lib/storage'
import { DEFAULT_FILTERS, filterJobs, salaryView, sortJobs } from './lib/ranking'
import type { Filters, SortKey } from './lib/ranking'
import { ROLE_FAMILIES, ROLE_FAMILY_LABELS } from './shared/taxonomy'
import { scoreJob } from './shared/scoring'
import { ProfilePanel, EMPTY_PROFILE } from './components/ProfilePanel'
import { CvImport } from './components/CvImport'
import { FilterChips } from './components/FilterChips'
import { SearchBar, type SearchValues } from './components/SearchBar'
import { Pagination } from './components/Pagination'
import { Footer } from './components/Footer'
import { JobRow } from './components/JobRow'
import { JobDetail } from './components/JobDetail'
import { SavedPanel } from './components/SavedPanel'
import { AlertsPanel } from './components/AlertsPanel'
import { useAccount } from './hooks/useAccount'
import { ProgressPanel } from './components/ProgressPanel'
import { ReportDialog } from './components/ReportDialog'
import { deviceActivity } from './shared/activity'
import { controlEnabled } from './shared/quality'
import type { JobFacets } from './server/job-stats'

type Tab = 'saved' | 'alerts' | 'progress' | 'plan'

import type { LucideIcon } from 'lucide-react'

const DASHBOARD_TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'progress', label: 'Progress', icon: BarChart3 },
  { id: 'saved', label: 'Saved', icon: Bookmark },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'plan', label: 'Plan', icon: CreditCard },
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

import { copy } from './shared/copy'
import { track } from './lib/analytics'

export default function App() {
  const [knownJobs, setKnownJobs] = useState<Record<string, Job>>({})
  const [jobs, setJobs] = useState<Job[]>([])
  const [rates, setRates] = useState<RatesPayload | null>(null)
  const [health, setHealth] = useState<ApiHealth | null>(null)
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<JobFacets | null>(null)
  const [feedUpdatedAt, setFeedUpdatedAt] = useState<string | null>(null)
  const [staleDismissed, setStaleDismissed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [displayCurrency, setDisplayCurrency] = useState<string>(() =>
    readLocal<string>('currency', 'NGN'),
  )

  const account = useAccount()
  const { profile, saved, alerts, setProfile, setSaved, setAlerts } = account

  const initialQuery = new URLSearchParams(window.location.search)
  const [tab, setTab] = useState<Tab>(() => {
    const requested = initialQuery.get('tab') as Tab | null
    return requested && ['saved', 'alerts', 'plan'].includes(requested) ? requested : 'progress'
  })
  const [worldwide, setWorldwide] = useState(initialQuery.get('ww') === '1')
  const [page, setPage] = useState(Math.max(1, Number(initialQuery.get('page')) || 1))
  const view: 'browse' | 'dashboard' | 'profile' =
    window.location.pathname === '/dashboard'
      ? 'dashboard'
      : window.location.pathname === '/profile'
        ? 'profile'
        : 'browse'
  const writeUrl = (next: { filters?: Filters; page?: number; worldwide?: boolean; tab?: Tab }) => {
    const params = new URLSearchParams()
    const f = next.filters ?? filters
    if (f.query.trim()) params.set('q', f.query.trim())
    if (f.location?.trim()) params.set('loc', f.location.trim())
    if (f.country) params.set('country', f.country)
    if (f.roleFamilies[0]) params.set('role', f.roleFamilies[0])
    if (f.workModes.length) params.set('mode', f.workModes.join(','))
    if (f.seniorities.length) params.set('level', f.seniorities.join(','))
    const ww = next.worldwide ?? worldwide
    if (ww) params.set('ww', '1')
    const p = next.page ?? page
    if (p > 1) params.set('page', String(p))
    const t = next.tab ?? tab
    if (view === 'dashboard' && t !== 'progress') params.set('tab', t)
    const base = view === 'dashboard' ? '/dashboard' : view === 'profile' ? '/profile' : '/jobs'
    window.history.replaceState(null, '', params.size ? `${base}?${params}` : base)
  }
  const [selectedId, setSelectedId] = useState<string | null>(routeJobId)
  const [jobPage, setJobPage] = useState(() => routeJobId() !== null)
  const [jobPageError, setJobPageError] = useState<string | null>(null)
  const resultsScroll = useRef(0)
  const requestVersion = useRef(0)
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    query: initialQuery.get('q') ?? '',
    location: initialQuery.get('loc') ?? '',
    country: (initialQuery.get('country') ?? '').toUpperCase(),
    roleFamilies: initialQuery.get('role') ? [initialQuery.get('role')!] : [],
    workModes: initialQuery.get('mode') ? initialQuery.get('mode')!.split(',') : [],
    seniorities: initialQuery.get('level')
      ? (initialQuery.get('level')!.split(',') as Filters['seniorities'])
      : [],
  }))
  const [sort, setSort] = useState<SortKey>('relevance')
  const [toast, setToast] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [telegramLinked, setTelegramLinked] = useState(false)
  const [applyQuota, setApplyQuota] = useState<ApplyQuota | null>(null)
  const [billingPlans, setBillingPlans] = useState<PlanDefinition[]>([])
  const [billingEnabled, setBillingEnabled] = useState(false)
  const adminControls = new URLSearchParams(window.location.search).has('adminControls')

  const cautionBannerEnabled = (facets?.cautionShare ?? 1) < 0.2
  const staleListings =
    !staleDismissed && feedUpdatedAt
      ? Date.now() - Date.parse(feedUpdatedAt) > 24 * 3600_000
      : false

  useEffect(() => writeLocal('currency', displayCurrency), [displayCurrency])

  useEffect(() => {
    if (selectedId) track('job_view', selectedId)
  }, [selectedId])

  const load = useCallback(
    async (force = false) => {
      const version = ++requestVersion.current
      setLoading(true)
      setLoadError(null)
      try {
        const jobsResponse = await fetchJobs(
          (page - 1) * 20,
          filters.query,
          { ...filters },
          force,
          20,
        )
        if (version !== requestVersion.current) return
        setJobs(jobsResponse.jobs)
        setTotal(jobsResponse.total ?? jobsResponse.jobs.length)
        setFeedUpdatedAt(jobsResponse.updatedAt || null)

        setFacets(jobsResponse.facets || null)
      } catch (cause) {
        if (version === requestVersion.current)
          setLoadError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (version === requestVersion.current) setLoading(false)
      }
    },
    [filters, page],
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
    if (account.mode !== 'signed-in') {
      setApplyQuota(null)
      return
    }
    let active = true
    void fetchApplyQuota()
      .then((quota) => {
        if (active) setApplyQuota(quota)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [account.mode, account.user])
  useEffect(() => {
    void fetchPlans()
      .then((catalogue: PlanCatalogue) => {
        setBillingPlans(catalogue.plans)
        setBillingEnabled(Boolean(catalogue.plans.length))
      })
      .catch(() => {})
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
    } catch {
      setToast(copy('telegram.failed'))
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
    track('save', jobId)
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

  const runFastApply = async (jobId: string) => {
    track('apply_start', jobId)
    try {
      const result = await fastApply(jobId)
      track('apply_complete', jobId)
      setApplyQuota((current) =>
        current && result.remaining !== null
          ? { ...current, remaining: result.remaining, used: current.used + 1 }
          : current,
      )
      markApplied(jobId)
    } catch (error: unknown) {
      void fetchApplyQuota()
        .then(setApplyQuota)
        .catch(() => {})
      throw error
    }
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

        <nav className="topnav" aria-label="Primary">
          <a href="/jobs" aria-current={view === 'browse' ? 'page' : undefined}>
            Jobs
          </a>
          <a href="/pricing">Pricing</a>
          <a
            className="nav-dashboard"
            href="/dashboard"
            aria-current={view === 'dashboard' ? 'page' : undefined}
          >
            Dashboard
          </a>
        </nav>

        <div className="topbar__spacer" />

        <div className="topbar__actions">
          {account.mode === 'signed-in' && applyQuota && !applyQuota.unlimited && (
            <a className="chip chip--plain quota-meter" href="/dashboard?tab=plan">
              {Math.max(0, applyQuota.remaining)} / {applyQuota.limit} left today
            </a>
          )}
          {account.mode === 'signed-in' && account.user && (
            <a
              href="/dashboard"
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
              <a
                className="btn btn--primary btn--sm nav-signup"
                href="/auth/signup?returnTo=%2Fdashboard"
              >
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
              onFastApply={() => runFastApply(selected.job.id)}
              applyQuota={applyQuota}
              cautionBannerEnabled={cautionBannerEnabled}
            />
          )}
          <Footer />
        </main>
      ) : view === 'dashboard' ? (
        <main className="content dashboard">
          <div className="page-intro">
            <span className="eyebrow">Your space</span>
            <h1>Your dashboard</h1>
          </div>
          <nav className="tabs" aria-label="Your dashboard">
            {DASHBOARD_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="tab"
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id)
                  writeUrl({})
                }}
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
              loading={account.mode === 'loading'}
              activity={
                account.mode === 'signed-in' && account.activity
                  ? account.activity
                  : deviceActivity(saved)
              }
              unavailable={
                account.mode === 'loading' ||
                (account.mode === 'signed-in' && (!account.activity || account.activityError))
              }
            />
          )}
          {tab === 'plan' && (
            <PlanPanel
              signedIn={account.mode === 'signed-in'}
              billingEnabled={billingEnabled}
              plans={billingPlans}
              subscription={account.subscription}
              entitlements={account.entitlements}
              onRefresh={account.refresh}
              onRequireSignIn={requireSignIn}
            />
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
              canDeliver={telegramLinked && Boolean(health?.telegramConfigured)}
              onChange={setAlerts}
              onLinkTelegram={linkTelegram}
              onRequireSignIn={requireSignIn}
            />
          )}
          <Footer />
        </main>
      ) : view === 'profile' ? (
        <main className="content">
          <div className="page-intro">
            <span className="eyebrow">Improve my matches</span>
            <h1>Your skills and preferences</h1>
            <p>Add what you know how to do. We use it only to rank the jobs you see.</p>
          </div>
          <div className="field" style={{ maxWidth: 280 }}>
            <label className="field__label" htmlFor="display-currency">
              Display currency
            </label>
            <select
              id="display-currency"
              className="select"
              value={displayCurrency}
              onChange={(event) => setDisplayCurrency(event.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <ProfilePanel
            profile={profile}
            onChange={setProfile}
            onReset={() => setProfile(EMPTY_PROFILE)}
            coverage={facets?.coverage}
            adminControls={adminControls}
          />
          <CvImport onApply={applySuggestion} />
          <Footer />
        </main>
      ) : (
        <main className="content browse">
          <div className="page-intro">
            <h1>Find work that fits your skills</h1>
            <p>Real opportunities in Nigeria and worldwide.</p>
          </div>
          <SearchBar
            value={{
              query: filters.query,
              location: filters.location ?? '',
              countryCode: filters.country ?? '',
            }}
            professionSuggestions={ROLE_FAMILIES.map((family) => ({
              id: family,
              label: ROLE_FAMILY_LABELS[family],
            }))}
            onSubmit={(next: SearchValues) => {
              track('search', next.query || next.location || '')
              const updated = {
                ...filters,
                query: next.query,
                location: next.location,
                country: next.countryCode,
              }
              setFilters(updated)
              setPage(1)
              writeUrl({ filters: updated, page: 1 })
            }}
          />
          <FilterChips
            filters={filters}
            coverage={facets?.coverage}
            adminControls={adminControls}
            worldwide={worldwide}
            counts={facets || undefined}
            onChange={(updated) => {
              setFilters(updated)
              setPage(1)
              writeUrl({ filters: updated, page: 1 })
            }}
            onWorldwide={(next) => {
              setWorldwide(next)
              setPage(1)
              writeUrl({ worldwide: next, page: 1 })
            }}
            onReset={() => {
              setFilters(DEFAULT_FILTERS)
              setWorldwide(false)
              setPage(1)
              writeUrl({ filters: DEFAULT_FILTERS, worldwide: false, page: 1 })
            }}
          />
          <div className="results-head">
            <span className="resultcount">
              {total.toLocaleString()} {total === 1 ? 'job' : 'jobs'}
              {filters.query.trim() ? ` for \u201c${filters.query.trim()}\u201d` : ''}
              {(filters.location?.trim() || filters.country) && (
                <>
                  {' in '}
                  {filters.location?.trim() || filters.country}
                </>
              )}
            </span>
            <div className="toolbar__spacer" />
            <label className="visually-hidden" htmlFor="sort">
              Sort
            </label>
            <select
              id="sort"
              className="select"
              style={{ width: 'auto' }}
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortKey)
              }}
            >
              <option value="relevance">Best match</option>
              <option value="newest">Newest first</option>
              {controlEnabled(facets?.coverage, 'salary', adminControls) && (
                <>
                  <option value="salary-desc">Salary, high to low</option>
                  <option value="salary-asc">Salary, low to high</option>
                </>
              )}
            </select>
          </div>
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
          {loadError && (
            <div className="banner banner--demo" role="status">
              <span>{copy('jobs.unavailable')}</span>
              <button type="button" className="btn btn--sm" onClick={() => void load(true)}>
                Try again
              </button>
            </div>
          )}
          <div className="joblist">
            {loading ? (
              <div className="empty" role="status">
                <span className="spinner" />
                <p>Finding your next opportunity…</p>
              </div>
            ) : sorted.jobs.length === 0 ? (
              <div className="empty">
                <p className="empty__title">No roles match</p>
                <p>Try loosening a filter or clearing your search.</p>
                <a
                  className="btn btn--sm"
                  href={`/dashboard?tab=alerts&q=${encodeURIComponent(filters.query)}`}
                >
                  Create an alert for this search
                </a>
              </div>
            ) : (
              sorted.jobs.map((entry) => (
                <JobRow
                  key={entry.job.id}
                  scored={entry}
                  selected={entry.job.id === selectedId}
                  salary={salaryView(entry.job, rates, displayCurrency)}
                  saved={savedIds.has(entry.job.id)}
                  onSave={() => toggleSave(entry.job.id)}
                  onReport={() => setReportingId(entry.job.id)}
                  cautionBannerEnabled={cautionBannerEnabled}
                  onSelect={() => openJob(entry.job.id)}
                />
              ))
            )}
          </div>
          <Pagination
            page={page}
            pageCount={Math.max(1, Math.ceil(total / 20))}
            onChange={(next) => {
              setPage(next)
              writeUrl({ page: next })
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          />
          {account.mode === 'anonymous' && (
            <p className="local-note">
              Your profile and saved jobs stay on this device.{' '}
              <button type="button" onClick={requireSignIn}>
                Sign in to sync them.
              </button>
            </p>
          )}
          {staleListings && (
            <p className="hint stale-line" role="status">
              {copy('stale.24h')}{' '}
              <button type="button" className="linkbtn" onClick={() => setStaleDismissed(true)}>
                Hide
              </button>
            </p>
          )}
          {facets && (
            <p className="hint market-line">
              {facets.remote.toLocaleString()} listed remote · {facets.locations} stated countries ·
              refreshed{' '}
              {feedUpdatedAt ? new Date(feedUpdatedAt).toLocaleString() : 'every 12 hours'}
            </p>
          )}
          <Footer />
        </main>
      )}
      {reportingId && <ReportDialog jobId={reportingId} onClose={() => setReportingId(null)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
