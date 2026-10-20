import type { Filters } from '../lib/ranking'
import { CountryPicker } from './CountryPicker'
import {
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
} from '../shared/taxonomy'

interface FilterBarProps {
  filters: Filters
  onChange: (filters: Filters) => void
  onReset: () => void
  counts?: { countries: Record<string, number>; professions: Record<string, number> }
}

export function FilterBar({ filters, onChange, onReset, counts }: FilterBarProps) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Narrow your search</h2>
        <button className="btn btn--ghost btn--sm" type="button" onClick={onReset}>
          Clear
        </button>
      </div>
      <div className="panel__body">
        <CountryPicker
          value={filters.country || ''}
          onChange={(country) => onChange({ ...filters, country })}
          counts={counts?.countries}
        />
        <div className="field">
          <label className="field__label" htmlFor="job-category">
            Profession
          </label>
          <select
            id="job-category"
            className="select"
            value={filters.roleFamilies[0] ?? ''}
            onChange={(event) =>
              onChange({ ...filters, roleFamilies: event.target.value ? [event.target.value] : [] })
            }
          >
            <option value="">All professions</option>
            {[...ROLE_FAMILIES]
              .sort((a, b) => ROLE_FAMILY_LABELS[a].localeCompare(ROLE_FAMILY_LABELS[b]))
              .map((family) => (
                <option key={family} value={family}>
                  {ROLE_FAMILY_LABELS[family]}
                  {counts ? ` (${counts.professions[family] || 0})` : ''}
                </option>
              ))}
            <option value="unknown">Other professions</option>
          </select>
        </div>
        <div className="field">
          <span className="field__label">Work arrangement</span>
          <div className="chiprow">
            {WORK_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="chipbtn"
                aria-pressed={filters.workModes.includes(mode)}
                onClick={() =>
                  onChange({
                    ...filters,
                    workModes: filters.workModes.includes(mode)
                      ? filters.workModes.filter((item) => item !== mode)
                      : [...filters.workModes, mode],
                  })
                }
              >
                {WORK_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <span className="field__hint">
            Remote doesn’t always mean you can work from any country. Check the listing’s location
            rules.
          </span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="job-level">
            Experience
          </label>
          <select
            id="job-level"
            className="select"
            value={filters.seniorities[0] ?? ''}
            onChange={(event) =>
              onChange({ ...filters, seniorities: event.target.value ? [event.target.value] : [] })
            }
          >
            <option value="">Any experience level</option>
            {SENIORITIES.map((level) => (
              <option key={level} value={level}>
                {SENIORITY_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
