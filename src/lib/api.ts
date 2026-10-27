import type {
  AlertPreference,
  ApiHealth,
  CvSuggestion,
  Job,
  JobAdvice,
  JobTranslation,
  Profile,
  RatesPayload,
  SavedApplication,
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
): Promise<JobsResponse> {
  const params = new URLSearchParams({ status: 'open', limit: '200', offset: String(offset) })
  if (query.trim()) params.set('q', query.trim())
  if (filters?.country) params.set('country', filters.country)
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

export interface ApplyQuota {
  unlimited: boolean
  limit: number
  used: number
  remaining: number
  resetsAt: string
  weekLimit: number
  weekUsed: number
}

export function fetchApplyQuota(): Promise<ApplyQuota> {
  return request<ApplyQuota>('/api/apply/quota', { cache: 'no-store' })
}

export interface FastApplyResult {
  ok: true
  remaining: number | null
  resetsAt: string
}

export function fastApply(
  jobId: string,
  coverNote?: string,
  useProfile = true,
): Promise<FastApplyResult> {
  return request<FastApplyResult>(`/api/jobs/${encodeURIComponent(jobId)}/fast-apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coverNote, useProfile }),
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

export function postSaved(jobId: string, status: 'saved' | 'applied'): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/account/saved', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId, status }),
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
  entitlements: string[]
  price: PlanPrice
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
