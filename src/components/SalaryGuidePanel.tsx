import { useEffect, useMemo, useState } from 'react'
import { Lock } from 'lucide-react'
import type { Profile, SalaryGuideResult } from '../shared/types'
import { ApiError, fetchSalaryGuide } from '../lib/api'
import { formatRange, PERIOD_LABELS } from '../shared/format'
import {
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
} from '../shared/taxonomy'

function money(value: number | null, currency: string | null): string {
  return value === null || !currency ? '' : formatRange(value, value, currency)
}

interface SalaryGuidePanelProps {
  profile: Profile
  countries: string[]
  proEnabled: boolean
}

export function SalaryGuidePanel({ profile, countries, proEnabled }: SalaryGuidePanelProps) {
  const [role, setRole] = useState(profile.targetRoleFamilies[0] ?? '')
  const [country, setCountry] = useState(profile.workCountry || 'NG')
  const [workMode, setWorkMode] = useState<string>(profile.preferredWorkModes[0] ?? '')
  const [seniority, setSeniority] = useState<string>(profile.targetSeniority[0] ?? '')
  const [currency, setCurrency] = useState('NGN')
  const [period, setPeriod] = useState('month')
  const [query, setQuery] = useState('')
  const [guide, setGuide] = useState<SalaryGuideResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(!proEnabled)
  const [failed, setFailed] = useState(false)

  const countryOptions = useMemo(
    () => [...new Set(['NG', profile.workCountry, ...countries].filter(Boolean))].sort(),
    [countries, profile.workCountry],
  )

  const load = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const result = await fetchSalaryGuide({
        role: role || undefined,
        country: country || undefined,
        workMode: workMode || undefined,
        seniority: seniority || undefined,
        currency: currency.trim().toUpperCase() || undefined,
        period: period || undefined,
        q: query.trim() || undefined,
      })
      setGuide(result.guide)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setLocked(true)
      else setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setLocked(!proEnabled)
    if (proEnabled) void load()
    // The first guide uses the saved profile defaults. Later changes load on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proEnabled])

  if (locked) {
    return (
      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Salary guide</h2>
        </div>
        <div className="panel__body">
          <p>
            Pro shows the middle pay and range from live FJ adverts that stated pay, with the number
            of adverts used. At least three matching adverts are required, so nothing is invented.
          </p>
          <p>
            <Lock size={14} /> <a href="/pricing">See Pro plans</a>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Salary guide</h2>
      </div>
      <div className="panel__body">
        <p>Choose a kind of role. The guide uses only live adverts that stated pay.</p>
        <div className="field">
          <label className="field__label" htmlFor="salary-role">
            Profession
          </label>
          <select
            id="salary-role"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">Any profession</option>
            {ROLE_FAMILIES.map((family) => (
              <option value={family} key={family}>
                {ROLE_FAMILY_LABELS[family] ?? family}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-country">
            Country
          </label>
          <select
            id="salary-country"
            className="select"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="">Any country</option>
            {countryOptions.map((code) => (
              <option value={code} key={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-mode">
            Work type
          </label>
          <select
            id="salary-mode"
            className="select"
            value={workMode}
            onChange={(event) => setWorkMode(event.target.value)}
          >
            <option value="">Any work type</option>
            {WORK_MODES.map((mode) => (
              <option value={mode} key={mode}>
                {WORK_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-level">
            Experience level
          </label>
          <select
            id="salary-level"
            className="select"
            value={seniority}
            onChange={(event) => setSeniority(event.target.value)}
          >
            <option value="">Any level</option>
            {SENIORITIES.map((level) => (
              <option value={level} key={level}>
                {SENIORITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-currency">
            Currency
          </label>
          <input
            id="salary-currency"
            className="input"
            value={currency}
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-period">
            Pay period
          </label>
          <select
            id="salary-period"
            className="select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="">Any period</option>
            <option value="month">Per month</option>
            <option value="year">Per year</option>
            <option value="hour">Per hour</option>
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="salary-query">
            Keyword, optional
          </label>
          <input
            id="salary-query"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="For example, nurse or React"
          />
        </div>
        <button
          className="btn btn--primary"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          {busy ? 'Checking…' : 'Show salary guide'}
        </button>
        {failed && <p role="status">The salary guide could not load just now. Please try again.</p>}
        {guide &&
          (guide.available ? (
            <div>
              <p>
                From {guide.sampleCount} adverts for {guide.scope}: middle pay about{' '}
                {money(guide.medianMidpoint, guide.currency)}
                {guide.period ? ` ${PERIOD_LABELS[guide.period]}` : ''}. The middle half runs from{' '}
                {money(guide.lowerQuartileMidpoint, guide.currency)} to{' '}
                {money(guide.upperQuartileMidpoint, guide.currency)}.
              </p>
              <p>
                Full stated range: {money(guide.lowest, guide.currency)} to{' '}
                {money(guide.highest, guide.currency)}.
              </p>
              <p className="field__hint">{guide.message}</p>
            </div>
          ) : (
            <p role="status">{guide.message}</p>
          ))}
      </div>
    </div>
  )
}
