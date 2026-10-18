import type {
  AlertPreference,
  ApiHealth,
  CvSuggestion,
  Job,
  Profile,
  RatesPayload,
  SavedApplication,
} from '../shared/types'

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
  jobs: Job[]
  dataSource: 'd1' | 'fixture'
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

export function fetchJobs(): Promise<JobsResponse> {
  return request<JobsResponse>('/api/jobs')
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
