import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { Profile } from '../shared/types'
import {
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SENIORITIES,
  SENIORITY_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
} from '../shared/taxonomy'
import { EligibilityPicker } from './EligibilityPicker'

export const EMPTY_PROFILE: Profile = {
  skills: [],
  targetRoleFamilies: [],
  targetSeniority: [],
  preferredWorkModes: [],
  workCountry: '',
}

interface ProfilePanelProps {
  profile: Profile
  onChange: (profile: Profile) => void
  onReset: () => void
}

export function ProfilePanel({ profile, onChange, onReset }: ProfilePanelProps) {
  const [draft, setDraft] = useState('')

  const addSkill = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (profile.skills.some((skill) => skill.toLowerCase() === value.toLowerCase())) {
      setDraft('')
      return
    }
    onChange({ ...profile, skills: [...profile.skills, value] })
    setDraft('')
  }

  const removeSkill = (skill: string) => {
    onChange({ ...profile, skills: profile.skills.filter((item) => item !== skill) })
  }

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Your preferences</h2>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onReset}
          title="Clear the profile"
        >
          <RotateCcw size={13} />
          Reset
        </button>
      </div>
      <div className="panel__body">
        <div className="field">
          <label className="field__label" htmlFor="skill-input">
            Skills
          </label>
          {profile.skills.length > 0 && (
            <div className="taglist">
              {profile.skills.map((skill) => (
                <span className="tag" key={skill}>
                  {skill}
                  <button
                    type="button"
                    className="tag__remove"
                    aria-label={`Remove ${skill}`}
                    onClick={() => removeSkill(skill)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            id="skill-input"
            className="input"
            value={draft}
            placeholder="Type a skill and press Enter"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addSkill(draft)
              }
            }}
          />
          <span className="field__hint">
            Add a few skills to see which jobs could be a good fit.
          </span>
        </div>

        <div className="field">
          <span className="field__label">Roles you’re interested in</span>
          <div className="chiprow">
            {ROLE_FAMILIES.map((family) => (
              <button
                key={family}
                type="button"
                className="chipbtn"
                aria-pressed={profile.targetRoleFamilies.includes(family)}
                onClick={() =>
                  onChange({
                    ...profile,
                    targetRoleFamilies: toggle(profile.targetRoleFamilies, family),
                  })
                }
              >
                {ROLE_FAMILY_LABELS[family]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Experience level</span>
          <div className="chiprow">
            {SENIORITIES.map((level) => (
              <button
                key={level}
                type="button"
                className="chipbtn"
                aria-pressed={profile.targetSeniority.includes(level)}
                onClick={() =>
                  onChange({ ...profile, targetSeniority: toggle(profile.targetSeniority, level) })
                }
              >
                {SENIORITY_LABELS[level]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Preferred work mode</span>
          <div className="chiprow">
            {WORK_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className="chipbtn"
                aria-pressed={profile.preferredWorkModes.includes(mode)}
                onClick={() =>
                  onChange({
                    ...profile,
                    preferredWorkModes: toggle(profile.preferredWorkModes, mode),
                  })
                }
              >
                {WORK_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <EligibilityPicker
          value={profile.workCountry}
          onChange={(workCountry) => onChange({ ...profile, workCountry })}
        />

        <p className="panel__note">
          Your profile is stored in this browser only. It is never sent to the server.
        </p>
      </div>
    </section>
  )
}
