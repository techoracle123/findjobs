import { useEffect, useState } from 'react'

interface AnalyticsQuestions {
  searchesThisWeek: number
  topQueries: Array<{ query: string; count: number }>
  jobViewsThisWeek: number
  savesThisWeek: number
  applyStartsThisWeek: number
  applyCompletesThisWeek: number
  viewToSavePercent: number
  applyStartToCompletePercent: number
}

/**
 * Analytics wallboard (Prompt 14): the eight operator questions as plain
 * aggregates. There are no per-person rows anywhere behind this page.
 */
export function AnalyticsWallboard() {
  const [data, setData] = useState<AnalyticsQuestions | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/admin/analytics', { cache: 'no-store' })
      if (!response.ok) throw new Error('failed')
      const body = (await response.json()) as { questions: AnalyticsQuestions }
      setData(body.questions)
    })().catch(() => setError(true))
  }, [])

  return (
    <main className="wrap" id="main">
      <h1>Analytics</h1>
      <p className="lede">
        This week, counted as totals only. No personal data is collected — no names, no emails, no
        user ids.
      </p>
      {error && (
        <p className="banner banner--demo" role="status">
          Loading failed. Retry.
        </p>
      )}
      {data && (
        <>
          <div className="stat-grid">
            {[
              ['Searches', data.searchesThisWeek],
              ['Job views', data.jobViewsThisWeek],
              ['Saves', data.savesThisWeek],
              ['Apply starts', data.applyStartsThisWeek],
              ['Completed applies', data.applyCompletesThisWeek],
              ['View → save', `${data.viewToSavePercent}%`],
              ['Apply start → done', `${data.applyStartToCompletePercent}%`],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <span className="stat-card__label">{label}</span>
                <strong className="stat-card__value">{value}</strong>
              </div>
            ))}
          </div>
          <h2>What people look for</h2>
          {data.topQueries.length === 0 ? (
            <p>No searches yet this week.</p>
          ) : (
            <ol className="query-list">
              {data.topQueries.map((entry) => (
                <li key={entry.query}>
                  <span>{entry.query}</span>
                  <span>{entry.count}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  )
}
