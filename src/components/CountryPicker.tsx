import { useEffect, useId, useRef, useState } from 'react'
import { countryName, searchCountries } from '../shared/countries'

export function CountryPicker({
  value,
  onChange,
  counts,
}: {
  value: string
  onChange: (code: string) => void
  counts?: Record<string, number>
}) {
  const id = useId(),
    ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState(value ? countryName(value) : '')
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0)
  const results = searchCountries(query).slice(0, 60)
  useEffect(() => {
    setQuery(value ? countryName(value) : '')
  }, [value])
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery(value ? countryName(value) : '')
      }
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open, value])
  useEffect(() => {
    if (open) document.getElementById(id + '-' + active)?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active, open])
  const choose = (code: string) => {
    ref.current?.querySelector('input')?.focus()
    onChange(code)
    setQuery(code ? countryName(code) : '')
    setOpen(false)
  }
  return (
    <div
      className="field"
      ref={ref}
      onBlur={(event) => {
        if (!ref.current?.contains(event.relatedTarget)) {
          setOpen(false)
          setQuery(value ? countryName(value) : '')
        }
      }}
    >
      <label className="field__label" htmlFor={id}>
        Job location
      </label>
      <div className="combowrap">
        <input
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={id + '-options'}
          aria-autocomplete="list"
          aria-activedescendant={open ? id + '-' + active : undefined}
          autoComplete="off"
          placeholder="Search country or code"
          value={query}
          onClick={() => setOpen(true)}
          onFocus={() => {
            setQuery('')
            setActive(0)
            setOpen(true)
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(searchCountries(event.target.value).length ? 1 : 0)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              setQuery(value ? countryName(value) : '')
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setActive(Math.min(results.length, active + 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(Math.max(0, active - 1))
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault()
              choose(active === 0 ? '' : results[active - 1]?.code || '')
            }
          }}
        />
        {open && (
          <div className="combolist" id={id + '-options'} role="listbox" aria-label="Countries">
            <button
              type="button"
              className="combolist__item"
              id={id + '-0'}
              role="option"
              tabIndex={-1}
              data-active={active === 0}
              aria-selected={!value}
              onClick={() => choose('')}
            >
              Worldwide · all locations
            </button>
            {results.map((country, i) => (
              <button
                key={country.code}
                id={id + '-' + (i + 1)}
                type="button"
                className="combolist__item"
                role="option"
                tabIndex={-1}
                data-active={active === i + 1}
                aria-selected={country.code === value}
                onClick={() => choose(country.code)}
              >
                <span>{country.name}</span>
                <span className="combolist__code">
                  {counts ? `${(counts[country.code] || 0).toLocaleString()} jobs` : country.code}
                </span>
              </button>
            ))}
            {!results.length && <span className="combolist__item">No matching country</span>}
          </div>
        )}
      </div>
      <span className="field__hint">
        {value
          ? `Listings explicitly located in ${countryName(value)}.`
          : 'Choose a country, or explore all locations.'}
      </span>
    </div>
  )
}
