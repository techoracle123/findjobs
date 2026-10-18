import type { Filters } from '../lib/ranking'
import {
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
} from '../shared/taxonomy'
import { ELIGIBILITY_LABELS } from '../shared/scoring'
import type { EligibilityTier, VerificationLevel } from '../shared/types'
import { VERIFICATION_LABELS } from '../shared/verification'

interface FilterBarProps {
  filters: Filters
  onChange: (filters: Filters) => void
  onReset: () => void
}

export function FilterBar({ filters, onChange, onReset }: FilterBarProps) {
  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  const active =
    filters.workModes.length +
    filters.seniorities.length +
    filters.roleFamilies.length +
    filters.verification.length +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.eligibility !== 'all' ? 1 : 0) +
    (filters.includeClosed ? 1 : 0)

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Filters</h2>
        <div style={{ flex: 1 }} />
        {active > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
            Clear {active}
          </button>
        )}
      </div>
      <div className="panel__body">
        <div className="field">
          <span className="field__label">Eligibility</span>
          <div className="chiprow">
            <button
              type="button"
              className="chipbtn"
              aria-pressed={filters.eligibility === 'all'}
              onClick={() => onChange({ ...filters, eligibility: 'all' })}
            >
              Any
            </button>
            {(['eligible', 'unknown', 'restricted'] as EligibilityTier[]).map((tier) => (
              <button
                key={tier}
                type="button"
                className="chipbtn"
                aria-pressed={filters.eligibility === tier}
                onClick={() => onChange({ ...filters, eligibility: tier })}
              >
                {ELIGIBILITY_LABELS[tier]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Verification</span>
          <div className="chiprow">
            {(['verified', 'unverified', 'stale'] as VerificationLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className="chipbtn"
                aria-pressed={filters.verification.includes(level)}
                onClick={() =>
                  onChange({ ...filters, verification: toggle(filters.verification, level) })
                }
              >
                {VERIFICATION_LABELS[level]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Closed roles</span>
          <div className="chiprow">
            <button
              type="button"
              className="chipbtn"
              aria-pressed={!filters.includeClosed}
              onClick={() => onChange({ ...filters, includeClosed: false })}
            >
              Hide
            </button>
            <button
              type="button"
              className="chipbtn"
              aria-pressed={filters.includeClosed}
              onClick={() => onChange({ ...filters, includeClosed: true })}
            >
              Show
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">Work mode</span>
          <div className="chiprow">
            {WORK_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="chipbtn"
                aria-pressed={filters.workModes.includes(mode)}
                onClick={() => onChange({ ...filters, workModes: toggle(filters.workModes, mode) })}
              >
                {WORK_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Level</span>
          <div className="chiprow">
            {SENIORITIES.map((level) => (
              <button
                key={level}
                type="button"
                className="chipbtn"
                aria-pressed={filters.seniorities.includes(level)}
                onClick={() =>
                  onChange({ ...filters, seniorities: toggle(filters.seniorities, level) })
                }
              >
                {SENIORITY_LABELS[level]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Role family</span>
          <div className="chiprow">
            {ROLE_FAMILIES.map((family) => (
              <button
                key={family}
                type="button"
                className="chipbtn"
                aria-pressed={filters.roleFamilies.includes(family)}
                onClick={() =>
                  onChange({ ...filters, roleFamilies: toggle(filters.roleFamilies, family) })
                }
              >
                {ROLE_FAMILY_LABELS[family]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="min-score">
            Minimum match score: {filters.minScore}
          </label>
          <input
            id="min-score"
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minScore}
            onChange={(event) => onChange({ ...filters, minScore: Number(event.target.value) })}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </section>
  )
}
