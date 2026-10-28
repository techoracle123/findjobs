import { useEffect, useId, useRef, useState } from 'react'
import { Search, MapPin, X } from 'lucide-react'
import { searchCountries, countryName } from '../shared/countries'
import { NIGERIA_PLACES } from '../shared/places'

export interface SearchValues {
  query: string
  location: string
  countryCode: string
}

interface SearchBarProps {
  value: SearchValues
  professionSuggestions: { id: string; label: string }[]
  onSubmit: (value: SearchValues) => void
}

const RECENT_KEY = 'rolesignal:recent-searches'

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]
  } catch {
    return []
  }
}

function remember(term: string) {
  if (!term.trim()) return
  try {
    const next = [term.trim(), ...readRecent().filter((item) => item !== term.trim())].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* Private browsing: recent searches are optional. */
  }
}

/**
 * One bordered container with What and Where. Keyboard navigable, with the
 * ARIA listbox pattern; suggestions put Nigerian places first.
 */
export function SearchBar({ value, professionSuggestions, onSubmit }: SearchBarProps) {
  const [what, setWhat] = useState(value.query)
  const [where, setWhere] = useState(
    value.location || (value.countryCode ? countryName(value.countryCode) : ''),
  )
  const [whatOpen, setWhatOpen] = useState(false)
  const [whereOpen, setWhereOpen] = useState(false)
  const [whatIndex, setWhatIndex] = useState(0)
  const [whereIndex, setWhereIndex] = useState(0)
  const whatId = useId()
  const whereId = useId()
  const wrapRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setWhat(value.query)
    setWhere(value.location || (value.countryCode ? countryName(value.countryCode) : ''))
  }, [value.query, value.location, value.countryCode])

  const whatSuggestions = [
    ...readRecent()
      .filter((item) => item.toLowerCase().includes(what.toLowerCase()))
      .map((item) => ({ kind: 'recent' as const, label: item, code: '' })),
    ...professionSuggestions
      .filter((item) => item.label.toLowerCase().includes(what.toLowerCase()))
      .map((item) => ({ kind: 'profession' as const, label: item.label, code: item.id })),
  ].slice(0, 8)

  const whereSuggestions = [
    ...NIGERIA_PLACES.filter((place) => place.toLowerCase().includes(where.toLowerCase())).map(
      (place) => ({ kind: 'nigeria' as const, label: place, code: place }),
    ),
    ...searchCountries(where)
      .slice(0, 6)
      .map((country) => ({ kind: 'country' as const, label: country.name, code: country.code })),
  ].slice(0, 10)

  const submit = () => {
    remember(what)
    const match = searchCountries(where)[0]
    onSubmit({
      query: what.trim(),
      location: match && where.toLowerCase() === match.name.toLowerCase() ? '' : where.trim(),
      countryCode: match && where.toLowerCase() === match.name.toLowerCase() ? match.code : '',
    })
    setWhatOpen(false)
    setWhereOpen(false)
  }

  return (
    <form
      ref={wrapRef}
      className="searchbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="searchbar__field">
        <label className="visually-hidden" htmlFor={`${whatId}-input`}>
          What
        </label>
        <Search size={16} className="searchbar__icon" aria-hidden="true" />
        <input
          id={`${whatId}-input`}
          className="input searchbar__input"
          placeholder="Role, skill or company"
          value={what}
          autoComplete="off"
          role="combobox"
          aria-expanded={whatOpen}
          aria-controls={`${whatId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={whatOpen ? `${whatId}-${whatIndex}` : undefined}
          onFocus={() => setWhatOpen(true)}
          onChange={(event) => {
            setWhat(event.target.value)
            setWhatIndex(0)
            setWhatOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setWhatOpen(true)
              setWhatIndex((index) => Math.min(whatSuggestions.length - 1, index + 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setWhatIndex((index) => Math.max(0, index - 1))
            }
            if (event.key === 'Enter' && whatOpen && whatSuggestions[whatIndex]) {
              event.preventDefault()
              setWhat(whatSuggestions[whatIndex].label)
              setWhatOpen(false)
            }
            if (event.key === 'Escape') setWhatOpen(false)
          }}
        />
        {what && (
          <button
            type="button"
            className="searchbar__clear"
            aria-label="Clear role search"
            onClick={() => {
              setWhat('')
              onSubmit({ query: '', location: value.location, countryCode: value.countryCode })
            }}
          >
            <X size={14} />
          </button>
        )}
        {whatOpen && whatSuggestions.length > 0 && (
          <ul className="combolist searchbar__list" id={`${whatId}-list`} role="listbox">
            {whatSuggestions.map((item, index) => (
              <li
                key={`${item.kind}-${item.label}`}
                id={`${whatId}-${index}`}
                role="option"
                aria-selected={index === whatIndex}
                className="combolist__item"
                data-active={index === whatIndex}
                onPointerDown={() => {
                  setWhat(item.label)
                  setWhatOpen(false)
                  onSubmit({
                    query: item.label,
                    location: value.location,
                    countryCode: value.countryCode,
                  })
                }}
              >
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="searchbar__divider" aria-hidden="true" />
      <div className="searchbar__field">
        <label className="visually-hidden" htmlFor={`${whereId}-input`}>
          Where
        </label>
        <MapPin size={16} className="searchbar__icon" aria-hidden="true" />
        <input
          id={`${whereId}-input`}
          className="input searchbar__input"
          placeholder="City, state or country"
          value={where}
          autoComplete="off"
          role="combobox"
          aria-expanded={whereOpen}
          aria-controls={`${whereId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={whereOpen ? `${whereId}-${whereIndex}` : undefined}
          onFocus={() => setWhereOpen(true)}
          onChange={(event) => {
            setWhere(event.target.value)
            setWhereIndex(0)
            setWhereOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setWhereOpen(true)
              setWhereIndex((index) => Math.min(whereSuggestions.length - 1, index + 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setWhereIndex((index) => Math.max(0, index - 1))
            }
            if (event.key === 'Enter' && whereOpen && whereSuggestions[whereIndex]) {
              event.preventDefault()
              const picked = whereSuggestions[whereIndex]
              setWhere(picked.label)
              onSubmit({
                query: what,
                location: picked.kind === 'country' ? '' : picked.label,
                countryCode: picked.kind === 'country' ? picked.code : '',
              })
              setWhereOpen(false)
            }
            if (event.key === 'Escape') setWhereOpen(false)
          }}
        />
        {where && (
          <button
            type="button"
            className="searchbar__clear"
            aria-label="Clear location search"
            onClick={() => {
              setWhere('')
              onSubmit({ query: what, location: '', countryCode: '' })
            }}
          >
            <X size={14} />
          </button>
        )}
        {whereOpen && whereSuggestions.length > 0 && (
          <ul className="combolist searchbar__list" id={`${whereId}-list`} role="listbox">
            {whereSuggestions.map((item, index) => (
              <li
                key={`${item.kind}-${item.code}-${item.label}`}
                id={`${whereId}-${index}`}
                role="option"
                aria-selected={index === whereIndex}
                className="combolist__item"
                data-active={index === whereIndex}
                onPointerDown={() => {
                  setWhere(item.label)
                  setWhereOpen(false)
                  onSubmit({
                    query: what,
                    location: item.kind === 'country' ? '' : item.label,
                    countryCode: item.kind === 'country' ? item.code : '',
                  })
                }}
              >
                <span>{item.label}</span>
                <span className="combolist__code">
                  {item.kind === 'nigeria' ? 'Nigeria' : item.code}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button className="btn btn--primary searchbar__submit" type="submit">
        <Search size={15} /> Search
      </button>
    </form>
  )
}
