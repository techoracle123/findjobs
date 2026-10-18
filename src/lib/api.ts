import type { ApiHealth, CvSuggestion, Job, RatesPayload } from '../shared/types'

/**
 * Relative URLs only: the Vite dev server proxies /api to the local worker,
 * and the deployed Pages app serves /api from the Pages Function.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status}) ${body.slice(0, 200)}`)
  }
  return (await response.json()) as T
}

export interface JobsResponse {
  jobs: Job[]
  dataSource: 'd1' | 'fixture'
  warning?: string
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
