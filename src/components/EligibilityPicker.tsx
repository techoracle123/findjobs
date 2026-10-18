import { useEffect, useMemo, useRef, useState } from 'react'
import { countryName, searchCountries } from '../shared/countries'

interface EligibilityPickerProps {
  value: string
  onChange: (code: string) => void
}

/**
 * Work-eligibility picker. Searches every ISO alpha-2 region except
 * Antarctica, and shows the code alongside each name.
 */
export function EligibilityPicker({ value, onChange }: EligibilityPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => searchCountries(query).slice(0, 80), [query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div className="field">
      <label className="field__label" htmlFor="eligibility-search">
        Work country
      </label>
      <div className="combowrap" ref={wrapRef}>
        <input
          id="eligibility-search"
          className="input"
          value={query}
          placeholder="Search country or code"
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {open && (
          <div className="combolist" role="listbox">
            {results.length === 0 && (
              <div className="combolist__item" style={{ color: 'var(--faint)' }}>
                No matching region
              </div>
            )}
            {results.map((country) => (
              <button
                key={country.code}
                type="button"
                className="combolist__item"
                role="option"
                aria-selected={country.code === value}
                onClick={() => {
                  onChange(country.code)
                  setQuery(country.name)
                  setOpen(false)
                }}
              >
                <span>{country.name}</span>
                <span className="combolist__code">{country.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="field__hint">
        {value ? `Eligibility is checked against ${countryName(value)}.` : 'No country set — eligibility cannot be checked yet.'}
      </span>
    </div>
  )
}
