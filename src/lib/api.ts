import type {
  AlertPreference,
  ApiHealth,
  AdvertCheckResult,
  ApplicationAnswers,
  BestMatch,
  CvCheckResult,
  CvSuggestion,
  GraduateEligibilityInput,
  GraduateEligibilityState,
  InterviewPrep,
  Job,
  JobAdvice,
  JobTranslation,
  MasterCv,
  PreparedApplication,
  ProTrialState,
  Profile,
  RatesPayload,
  SalaryGuideResult,
  SavedApplication,
  SkillPlanResult,
} from '../shared/types'
import { monthPeriod, type ApplicationActivity } from '../shared/activity'
import type { JobFacets } from '../server/job-stats'
import type { Filters } from './ranking'

/**
 * Relative URLs only: the Vite dev server proxies /api to the local worker,
 * and the deployed Pages app serves /api from the Pages Function.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new ApiError(
      `${init?.method ?? 'GET'} ${path} failed (${response.status})`,
      response.status,
      body,
    )
  }
  return (await response.json()) as T
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface JobsResponse {
  facets?: JobFacets
  updatedAt?: string
  refreshHours?: number
  sourceCount?: number
  jobs: Job[]
  total?: number
  dataSource: 'd1' | 'fixture' | 'live-public' | 'public-snapshot'
  warning?: string
}

export interface AccountUser {
  id: string
  email: string
  displayName: string | null
  createdAt: string
}

export interface Subscription {
  id: string
  userId: string
  provider: string
  providerCustomerId: string | null
  providerSubscriptionId: string | null
  plan: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export interface AccountSnapshot {
  user: AccountUser
  profile: Profile
  saved: SavedApplication[]
  alerts: AlertPreference[]
  subscription: Subscription | null
  entitlements: string[]
  proTrial: ProTrialState
  graduateEligibility: GraduateEligibilityState | null
}

export function fetchHealth(): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health')
}

const jobsCache = new Map<string, { at: number; value: JobsResponse }>()
const jobsPending = new Map<string, Promise<JobsResponse>>()
export function fetchJobs(
  offset = 0,
  query = '',
  filters?: Filters,
  force = false,
  limit = 20,
): Promise<JobsResponse> {
  const params = new URLSearchParams({
    status: 'open',
    limit: String(limit),
    offset: String(offset),
  })
  if (query.trim()) params.set('q', query.trim())
  if (filters?.country) params.set('country', filters.country)
  if (filters?.location) params.set('loc', filters.location)
  if (filters?.roleFamilies.length) params.set('roles', filters.roleFamilies.join(','))
  if (filters?.workModes.length) params.set('modes', filters.workModes.join(','))
  if (filters?.seniorities.length) params.set('levels', filters.seniorities.join(','))
  const key = params.toString()
  const hit = jobsCache.get(key)
  if (!force && hit && Date.now() - hit.at < 5 * 60000) return Promise.resolve(hit.value)
  const active = jobsPending.get(key)
  if (active) return active
  const work = request<JobsResponse>(
    `/api/jobs?${params}`,
    force ? { headers: { 'cache-control': 'no-cache' } } : undefined,
  )
    .then((value) => {
      if (jobsCache.size >= 20) jobsCache.delete(jobsCache.keys().next().value!)
      jobsCache.set(key, { value, at: Date.now() })
      return value
    })
    .finally(() => jobsPending.delete(key))
  jobsPending.set(key, work)
  return work
}

export async function fetchJob(id: string): Promise<Job> {
  return (await request<{ job: Job }>(`/api/jobs/${encodeURIComponent(id)}`)).job
}

export function fetchRates(): Promise<RatesPayload> {
  return request<RatesPayload>('/api/rates')
}

export function suggestFromCv(text: string): Promise<CvSuggestion> {
  return request<CvSuggestion>('/api/cv/suggest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

/* ---------- Phase 2 Pro access ---------- */

export interface ProAccess {
  paid: boolean
  trial: ProTrialState
  graduate: GraduateEligibilityState | null
  features: string[]
}

export function fetchProAccess(): Promise<ProAccess> {
  return request<ProAccess>('/api/pro/access', { cache: 'no-store' })
}

export function startProTrial(): Promise<{
  trial: ProTrialState
  paid: boolean
  alreadyUsed: boolean
}> {
  return request('/api/pro/trial/start', { method: 'POST' })
}

export function fetchGraduateEligibility(): Promise<{ graduate: GraduateEligibilityState | null }> {
  return request('/api/pro/graduate-eligibility', { cache: 'no-store' })
}

export function submitGraduateEligibility(
  graduate: GraduateEligibilityInput,
  cvText = '',
): Promise<{ graduate: GraduateEligibilityState }> {
  return request('/api/pro/graduate-eligibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ graduate, cvText }),
  })
}

export function fetchMasterCv(includeText = false): Promise<{
  cv: MasterCv | null
  locked: boolean
  trial: ProTrialState
  paid: boolean
}> {
  return request(`/api/pro/cv${includeText ? '?includeText=1' : ''}`, { cache: 'no-store' })
}

export function saveMasterCv(input: {
  fileName: string
  fileType: string
  text: string
  consent: boolean
}): Promise<{ cv: MasterCv; trial: ProTrialState; paid: boolean }> {
  return request('/api/pro/cv', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteMasterCv(): Promise<{ ok: true }> {
  return request('/api/pro/cv', { method: 'DELETE' })
}

export function runAdvertCheck(input: {
  title?: string
  company?: string
  location?: string
  url?: string
  text: string
}): Promise<{ check: AdvertCheckResult }> {
  return request('/api/pro/advert-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function runJobAdvertCheck(jobId: string): Promise<{ check: AdvertCheckResult }> {
  return request(`/api/jobs/${encodeURIComponent(jobId)}/before-you-apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export function fetchBestMatches(limit = 12): Promise<{
  available: boolean
  message: string
  totalJobs: number
  updatedAt: string | null
  matches: BestMatch[]
}> {
  return request(`/api/pro/best-matches?limit=${limit}`, { cache: 'no-store' })
}

export function fetchSkillPlan(): Promise<{ plan: SkillPlanResult }> {
  return request('/api/pro/skill-plan', { cache: 'no-store' })
}

/* ---------- Pro tools ---------- */

export function fetchApplicationAnswers(): Promise<{ answers: ApplicationAnswers }> {
  return request<{ answers: ApplicationAnswers }>('/api/pro/application-answers')
}

export function saveApplicationAnswers(
  answers: ApplicationAnswers,
): Promise<{ answers: ApplicationAnswers }> {
  return request<{ answers: ApplicationAnswers }>('/api/pro/application-answers', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
}

export function fetchPreparedApplication(
  jobId: string,
): Promise<{ prepared: PreparedApplication | null }> {
  return request<{ prepared: PreparedApplication | null }>(
    `/api/jobs/${encodeURIComponent(jobId)}/prepared-application`,
  )
}

export function createPreparedApplication(
  jobId: string,
  answers?: ApplicationAnswers,
): Promise<{ prepared: PreparedApplication; trial?: ProTrialState; paid?: boolean }> {
  return request<{ prepared: PreparedApplication; trial?: ProTrialState; paid?: boolean }>(
    `/api/jobs/${encodeURIComponent(jobId)}/prepared-application`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answers ? { answers } : {}),
    },
  )
}

export function checkCvForJob(
  jobId: string,
  cvText: string,
): Promise<{ check: CvCheckResult; trial?: ProTrialState; paid?: boolean }> {
  return request<{ check: CvCheckResult; trial?: ProTrialState; paid?: boolean }>(
    `/api/jobs/${encodeURIComponent(jobId)}/cv-check`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cvText }),
    },
  )
}

export function fetchInterviewPrep(jobId: string): Promise<{ prep: InterviewPrep }> {
  return request<{ prep: InterviewPrep }>(`/api/jobs/${encodeURIComponent(jobId)}/interview-prep`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export function fetchSalaryGuide(params: Record<string, string | undefined>): Promise<{
  guide: SalaryGuideResult
}> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  return request<{ guide: SalaryGuideResult }>(`/api/salary-guide?${query}`)
}

/* ---------- account ---------- */

export function fetchAccount(): Promise<AccountSnapshot> {
  return request<AccountSnapshot>('/api/account')
}

export function putProfile(profile: Profile): Promise<{ profile: Profile }> {
  return request<{ profile: Profile }>('/api/account/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile }),
  })
}

/** Fire-and-forget: the outbound link must never wait on this. */
export function recordApplyClick(jobId: string): void {
  try {
    const url = `/api/jobs/${encodeURIComponent(jobId)}/apply-click`
    if (navigator.sendBeacon) navigator.sendBeacon(url)
    else void fetch(url, { method: 'POST', keepalive: true }).catch(() => {})
  } catch {
    /* Analytics can never block an application. */
  }
}

export function postSaved(
  jobId: string,
  status: 'saved' | 'applied',
  extra?: Partial<SavedApplication>,
): Promise<{ ok: true; proRequired?: boolean }> {
  return request<{ ok: true }>('/api/account/saved', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId,
      status,
      stage: extra?.stage,
      followUpAt: extra?.followUpAt,
      note: extra?.note,
    }),
  })
}

export function deleteSaved(jobId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/account/saved/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export function postAlert(alert: AlertPreference): Promise<{ alert: AlertPreference }> {
  return request<{ alert: AlertPreference }>('/api/account/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(alert),
  })
}

export function patchAlert(id: string, patch: Partial<AlertPreference>): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/account/alerts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function deleteAlert(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/account/alerts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export interface ImportResult {
  imported: { profile: boolean; saved: number; alerts: number }
}

export function importAccount(payload: {
  profile: Profile
  saved: SavedApplication[]
  alerts: AlertPreference[]
}): Promise<ImportResult> {
  return request<ImportResult>('/api/account/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/* ---------- telegram ---------- */

export interface TelegramStatus {
  configured: boolean
  linked: boolean
  botUsername: string | null
}

export function fetchTelegramStatus(): Promise<TelegramStatus> {
  return request<TelegramStatus>('/api/telegram/status')
}

export function createTelegramLink(): Promise<{ url: string; token: string }> {
  return request<{ url: string; token: string }>('/api/telegram/link', { method: 'POST' })
}

/* ---------- billing ---------- */

export interface PlanPrice {
  amount: number
  currency: string
}

export interface PlanDefinition {
  id: string
  label: string
  displayLabel?: string
  entitlements: string[]
  price: PlanPrice
  interval?: 'free' | 'month' | 'year' | 'waitlist'
  audience?: 'seeker' | 'employer'
  monthlyEquivalent?: number
  founding?: boolean
  standardAmount?: number
  trialDays?: number
}

export interface PlanCatalogue {
  plans: PlanDefinition[]
  provider: string
  currency: string
  billingEnabled: boolean
}

export function fetchPlans(): Promise<PlanCatalogue> {
  return request<PlanCatalogue>('/api/billing/plans')
}

export function fetchSubscription(): Promise<{
  subscription: Subscription | null
  entitlements: string[]
}> {
  return request('/api/billing/subscription')
}

export function startCheckout(plan: string): Promise<{ session: { id: string; url: string } }> {
  return request('/api/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
}

export function openBillingPortal(): Promise<{ session: { url: string } }> {
  return request('/api/billing/portal', { method: 'POST' })
}

export function cancelSubscription(): Promise<{ subscription: Subscription }> {
  return request('/api/billing/cancel', { method: 'POST' })
}

export function exportAccount(): Promise<unknown> {
  return request('/api/account/export')
}

export function translateJob(id: string): Promise<JobTranslation> {
  return request<JobTranslation>(`/api/jobs/${encodeURIComponent(id)}/translation`, {
    method: 'POST',
  })
}
export function jobAdvice(id: string, skills: string[]): Promise<JobAdvice> {
  return request<JobAdvice>(`/api/jobs/${encodeURIComponent(id)}/tips`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ skills }),
  })
}

export function fetchApplicationActivity(): Promise<ApplicationActivity> {
  const params = new URLSearchParams(monthPeriod())
  return request<ApplicationActivity>(`/api/account/activity?${params}`, { cache: 'no-store' })
}
