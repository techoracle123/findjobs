import { useEffect, useState } from 'react'
import { copy } from '../shared/copy'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { QualitySnapshot } from '../shared/quality'
import { QUALITY_FIELDS, QUALITY_FLOORS, FIELD_THRESHOLD } from '../shared/quality'

interface Payload {
  quality: QualitySnapshot
  source: string
}

const FIELD_LABELS: Record<string, string> = {
  locationCountry: 'Country stated',
  workMode: 'Work mode',
  seniority: 'Experience level',
  salary: 'Salary',
  requiredSkills: 'Skills extracted',
  roleFamily: 'Profession',
  language: 'Language detected',
  eligibleCountries: 'Eligibility countries',
}

/** The data-quality wallboard: completeness first, everything else secondary. */
export function QualityWallboard() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/quality', { cache: 'no-store' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(
          response.status === 403
            ? 'Your account is not on the admin allowlist (ADMIN_EMAILS).'
            : body.error || `Request failed (${response.status})`,
        )
      }
      setPayload((await response.json()) as Payload)
    } catch {
      setError(copy('admin.unavailable'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const quality = payload?.quality

  return (
    <main className="admin-page">
      <a className="auth-back" href="/">
        <ArrowLeft size={16} /> Back to FJ
      </a>
      <header className="page-intro">
        <span className="eyebrow">Admin</span>
        <h1>Data quality</h1>
        <p>
          Field completeness across the published corpus. Controls in the product stay hidden until
          a field clears {Math.round(FIELD_THRESHOLD * 100)}%.
        </p>
      </header>
      {loading && <p role="status">Loading quality data…</p>}
      {error && (
        <div className="banner banner--demo" role="alert">
          {error}
        </div>
      )}
      {quality && (
        <>
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">
                Completeness: {quality.date} · normalizer {quality.normalizerVersion}
              </h2>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => void load()}>
                <RefreshCw size={13} /> Refresh
              </button>
            </div>
            <div className="panel__body">
              <table className="quality-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Populated</th>
                    <th>Floor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {QUALITY_FIELDS.map((field) => {
                    const pct = quality.coverage[field]
                    const floor = QUALITY_FLOORS[field] ?? FIELD_THRESHOLD
                    const ok = pct >= floor
                    return (
                      <tr key={field}>
                        <td>{FIELD_LABELS[field] ?? field}</td>
                        <td>{Math.round(pct * 100)}%</td>
                        <td>{Math.round(floor * 100)}%</td>
                        <td>
                          <span className={`chip ${ok ? 'chip--ok' : 'chip--demo'}`}>
                            {ok ? 'OK' : 'Below floor'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Corpus</h2>
            </div>
            <div className="panel__body stat-grid">
              <div>
                <strong>{quality.total.toLocaleString()}</strong>
                <span>Published listings</span>
              </div>
              <div>
                <strong>{quality.duplicatesDropped.toLocaleString()}</strong>
                <span>Duplicates dropped</span>
              </div>
              <div>
                <strong>{quality.nonEnglish.toLocaleString()}</strong>
                <span>Non-English listings</span>
              </div>
              <div>
                <strong>{quality.implausibleSalaries.toLocaleString()}</strong>
                <span>Salaries discarded as implausible</span>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Worst sources by country completeness</h2>
            </div>
            <div className="panel__body">
              <table className="quality-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Listings</th>
                    <th>Country</th>
                    <th>Skills</th>
                  </tr>
                </thead>
                <tbody>
                  {[...quality.sources]
                    .sort(
                      (a, b) =>
                        (a.coverage.locationCountry ?? 0) - (b.coverage.locationCountry ?? 0),
                    )
                    .slice(0, 10)
                    .map((row) => (
                      <tr key={row.sourceId}>
                        <td>{row.sourceId}</td>
                        <td>{row.total.toLocaleString()}</td>
                        <td>{Math.round((row.coverage.locationCountry ?? 0) * 100)}%</td>
                        <td>{Math.round((row.coverage.requiredSkills ?? 0) * 100)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          {quality.alerts.length > 0 && (
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">Alerts</h2>
              </div>
              <div className="panel__body">
                {quality.alerts.map((alert) => (
                  <p key={alert} className="banner banner--demo">
                    {alert}
                  </p>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  )
}
