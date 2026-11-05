import type { IdeaDetailResponse, IdeaListResponse, TrendResponse } from '../shared/ideas'

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  const body = (await response.json().catch(() => null)) as
    (T & { message?: string; error?: string }) | null
  if (!response.ok || !body) {
    throw new Error(body?.message || 'This could not be loaded. Please try again.')
  }
  return body
}

export function fetchIdeas(params: URLSearchParams, signal?: AbortSignal) {
  return request<IdeaListResponse>(`/api/ideas?${params.toString()}`, signal)
}

export function fetchIdea(id: string, signal?: AbortSignal) {
  return request<IdeaDetailResponse>(`/api/ideas/${encodeURIComponent(id)}`, signal)
}

export function fetchIdeaTrends(geo: string, signal?: AbortSignal) {
  return request<TrendResponse>(`/api/idea-trends?geo=${encodeURIComponent(geo)}`, signal)
}
