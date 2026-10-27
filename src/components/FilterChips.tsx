import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Globe2,
  MapPin,
  Briefcase,
  Clock,
  GraduationCap,
  Wallet,
  BadgeCheck,
} from 'lucide-react'
import type { Filters } from '../lib/ranking'
import {
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
} from '../shared/taxonomy'
import { controlEnabled } from '../shared/quality'
import type { FieldCoverage } from '../shared/quality'
import { CountryPicker } from './CountryPicker'

interface FilterChipsProps {
  filters: Filters
  coverage?: FieldCoverage
  adminControls: boolean
  worldwide: boolean
  counts?: { countries: Record<string, number>; professions: Record<string, number> }
  onChange: (filters: Filters) => void
  onWorldwide: (worldwide: boolean) => void
  onReset: () => void
}

type ChipId = 'location' | 'profession' | 'experience' | 'workMode' | 'salary' | 'verified' | 'more'

/** One chip bar above the results. Every choice is written to the URL by App. */
export function FilterChips({
  filters,
  coverage,
  adminControls,
  worldwide,
  counts,
  onChange,
  onWorldwide,
  onReset,
}: FilterChipsProps) {
  const [open, setOpen] = useState<ChipId | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const showExperience = controlEnabled(coverage, 'seniority', adminControls)
  const showWorkMode = controlEnabled(coverage, 'workMode', adminControls)
  const showSalary = controlEnabled(coverage, 'salary', adminControls)
  const showVerified = adminControls // 100% of the corpus is unverified today.

  const toggle = (chip: ChipId) => setOpen((current) => (current === chip ? null : chip))
  const active = Boolean(
    filters.country ||
    filters.roleFamilies.length ||
    filters.seniorities.length ||
    filters.workModes.length ||
    filters.verification.length ||
    worldwide,
  )

  return (
    <div className="chipbar-wrap" ref={wrapRef}>
      <div className="chipbar">
        <button
          type="button"
          className="chipbtn"
          aria-expanded={open === 'location'}
          onClick={() => toggle('location')}
        >
          <MapPin size={13} /> {filters.country || 'Location'} <ChevronDown size={12} />
        </button>
        <button
          type="button"
          className="chipbtn"
          aria-expanded={open === 'profession'}
          onClick={() => toggle('profession')}
        >
          <Briefcase size={13} />
          {filters.roleFamilies[0] ? ROLE_FAMILY_LABELS[filters.roleFamilies[0]] : 'Profession'}
          <ChevronDown size={12} />
        </button>
        {showExperience && (
          <button
            type="button"
            className="chipbtn"
            aria-expanded={open === 'experience'}
            onClick={() => toggle('experience')}
          >
            <GraduationCap size={13} />
            {filters.seniorities[0]
              ? SENIORITY_LABELS[filters.seniorities[0] as 'intern']
              : 'Experience'}
            <ChevronDown size={12} />
          </button>
        )}
        {showWorkMode && (
          <button
            type="button"
            className="chipbtn"
            aria-expanded={open === 'workMode'}
            onClick={() => toggle('workMode')}
          >
            <Clock size={13} /> Work mode <ChevronDown size={12} />
          </button>
        )}
        {showSalary && (
          <button
            type="button"
            className="chipbtn"
            aria-pressed={filters.minScore > 0}
            onClick={() => onChange({ ...filters, minScore: filters.minScore > 0 ? 0 : 1 })}
          >
            <Wallet size={13} /> With salary
          </button>
        )}
        {showVerified && (
          <button
            type="button"
            className="chipbtn"
            aria-pressed={filters.verification.includes('verified')}
            onClick={() =>
              onChange({
                ...filters,
                verification: filters.verification.includes('verified') ? [] : ['verified'],
              })
            }
          >
            <BadgeCheck size={13} /> Verified only
          </button>
        )}
        <button
          type="button"
          className="chipbtn"
          aria-expanded={open === 'more'}
          onClick={() => toggle('more')}
        >
          <Globe2 size={13} /> More <ChevronDown size={12} />
        </button>
        {active && (
          <button type="button" className="chipbtn chipbtn--clear" onClick={onReset}>
            Clear all
          </button>
        )}
      </div>

      {open === 'location' && (
        <div className="chip-popover">
          <CountryPicker
            value={filters.country || ''}
            onChange={(country) => onChange({ ...filters, country })}
            counts={counts?.countries}
          />
        </div>
      )}
      {open === 'profession' && (
        <div className="chip-popover">
          <button
            type="button"
            className="combolist__item"
            onClick={() => {
              onChange({ ...filters, roleFamilies: [] })
              setOpen(null)
            }}
          >
            All professions
          </button>
          {[...ROLE_FAMILIES]
            .sort((a, b) => ROLE_FAMILY_LABELS[a].localeCompare(ROLE_FAMILY_LABELS[b]))
            .map((family) => (
              <button
                key={family}
                type="button"
                className="combolist__item"
                onClick={() => {
                  onChange({ ...filters, roleFamilies: [family] })
                  setOpen(null)
                }}
              >
                <span>{ROLE_FAMILY_LABELS[family]}</span>
                <span className="combolist__code">
                  {counts ? `${(counts.professions[family] || 0).toLocaleString()}` : ''}
                </span>
              </button>
            ))}
        </div>
      )}
      {open === 'experience' && (
        <div className="chip-popover">
          <button
            type="button"
            className="combolist__item"
            onClick={() => {
              onChange({ ...filters, seniorities: [] })
              setOpen(null)
            }}
          >
            Any experience
          </button>
          {SENIORITIES.map((level) => (
            <button
              key={level}
              type="button"
              className="combolist__item"
              onClick={() => {
                onChange({ ...filters, seniorities: [level] })
                setOpen(null)
              }}
            >
              {SENIORITY_LABELS[level]}
            </button>
          ))}
        </div>
      )}
      {open === 'workMode' && (
        <div className="chip-popover">
          {WORK_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className="combolist__item"
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
              {filters.workModes.includes(mode) && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
      {open === 'more' && (
        <div className="chip-popover">
          <button
            type="button"
            className="combolist__item"
            aria-pressed={worldwide}
            onClick={() => onWorldwide(!worldwide)}
          >
            Worldwide (show all languages)
            {worldwide && <Check size={13} />}
          </button>
          <p className="field__hint">
            By default you see English listings. Turn this on to include every language.
          </p>
        </div>
      )}
    </div>
  )
}
