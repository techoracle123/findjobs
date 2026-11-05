import { useState } from 'react'
import { Bell, Link2, Plus, Trash2 } from 'lucide-react'
import type { AlertPreference, OpportunityFilter, ProTrialState, WorkMode } from '../shared/types'
import { OPPORTUNITY_FILTER_OPTIONS } from '../shared/opportunities'
import { PRO_FREE_FOR_ALL } from '../shared/access'

interface AlertsPanelProps {
  alerts: AlertPreference[]
  telegramConfigured: boolean
  telegramLinked: boolean
  signedIn: boolean
  canDeliver: boolean
  proEnabled: boolean
  trial: ProTrialState
  onChange: (alerts: AlertPreference[]) => void
  onLinkTelegram: () => Promise<void>
  onRequireSignIn: () => void
  onOpenPlan: () => void
}

type SmartSettings = Pick<
  AlertPreference,
  'minScore' | 'countries' | 'workModes' | 'salaryOnly' | 'currency' | 'exclude' | 'companies'
>

const WORK_MODES: Array<{ value: WorkMode; label: string }> = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On site' },
]

function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function opportunityLabel(value: OpportunityFilter | undefined): string {
  return (
    OPPORTUNITY_FILTER_OPTIONS.find((option) => option.id === (value ?? 'all'))?.label ?? 'All work'
  )
}

function OpportunityField({
  id,
  value,
  onChange,
}: {
  id: string
  value: OpportunityFilter
  onChange: (value: OpportunityFilter) => void
}) {
  return (
    <label className="field" htmlFor={id}>
      Work to watch
      <select
        id={id}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value as OpportunityFilter)}
      >
        {OPPORTUNITY_FILTER_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <small>This choice is free for every alert.</small>
    </label>
  )
}

function SmartFields({
  settings,
  disabled,
  onPatch,
  prefix,
}: {
  settings: SmartSettings
  disabled: boolean
  onPatch: (patch: SmartSettings) => void
  prefix: string
}) {
  return (
    <fieldset className="smart-fields" disabled={disabled}>
      <legend>More filters</legend>
      <div className="form-grid">
        <label className="field">
          Minimum fit score
          <select
            value={settings.minScore ?? ''}
            onChange={(event) =>
              onPatch({
                minScore: event.target.value ? Number(event.target.value) : undefined,
              })
            }
          >
            <option value="">Any fit</option>
            <option value="40">40/100 or better</option>
            <option value="55">55/100 or better</option>
            <option value="70">70/100 or better</option>
            <option value="85">85/100 or better</option>
          </select>
          <small>Uses the skills and preferences in your profile.</small>
        </label>
        <label className="field">
          Countries (two-letter codes)
          <input
            key={`${prefix}-countries-${(settings.countries ?? []).join('-')}`}
            defaultValue={(settings.countries ?? []).join(', ')}
            placeholder="NG, GH, GB, US"
            onBlur={(event) =>
              onPatch({
                countries: parseList(event.target.value).map((code) => code.toUpperCase()),
              })
            }
          />
          <small>Leave empty for every country. NG means Nigeria.</small>
        </label>
        <label className="field">
          Pay currency
          <select
            value={settings.currency ?? ''}
            onChange={(event) => onPatch({ currency: event.target.value || undefined })}
          >
            <option value="">Any currency</option>
            <option value="NGN">Naira (NGN)</option>
            <option value="USD">US dollars (USD)</option>
            <option value="GBP">British pounds (GBP)</option>
            <option value="EUR">Euros (EUR)</option>
          </select>
        </label>
        <label className="field">
          Companies to watch
          <input
            key={`${prefix}-companies-${(settings.companies ?? []).join('-')}`}
            defaultValue={(settings.companies ?? []).join(', ')}
            placeholder="Company names separated by commas"
            onBlur={(event) => onPatch({ companies: parseList(event.target.value) })}
          />
        </label>
      </div>
      <div className="field">
        <span className="field__label">Work setting</span>
        <div className="checkrow">
          {WORK_MODES.map((mode) => (
            <label className="checkbox-field" key={mode.value}>
              <input
                type="checkbox"
                checked={Boolean(settings.workModes?.includes(mode.value))}
                onChange={(event) => {
                  const current = settings.workModes ?? []
                  onPatch({
                    workModes: event.target.checked
                      ? [...current, mode.value]
                      : current.filter((item) => item !== mode.value),
                  })
                }}
              />{' '}
              {mode.label}
            </label>
          ))}
        </div>
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={Boolean(settings.salaryOnly)}
          onChange={(event) => onPatch({ salaryOnly: event.target.checked || undefined })}
        />{' '}
        Only jobs that state pay
      </label>
      <label className="field">
        Words to exclude
        <input
          key={`${prefix}-exclude-${settings.exclude ?? ''}`}
          defaultValue={settings.exclude ?? ''}
          placeholder="e.g. commission only, unpaid, senior"
          onBlur={(event) => onPatch({ exclude: event.target.value.trim() || undefined })}
        />
      </label>
    </fieldset>
  )
}

function smartSummary(alert: AlertPreference): string {
  const parts: string[] = []
  if (alert.opportunityType && alert.opportunityType !== 'all') {
    parts.push(opportunityLabel(alert.opportunityType))
  }
  if (alert.minScore) parts.push(`${alert.minScore}+ fit score`)
  if (alert.countries?.length) parts.push(alert.countries.join(', '))
  if (alert.workModes?.length) parts.push(alert.workModes.join(', '))
  if (alert.salaryOnly) parts.push('pay stated')
  if (alert.currency) parts.push(alert.currency)
  if (alert.companies?.length) parts.push(`companies: ${alert.companies.join(', ')}`)
  if (alert.exclude) parts.push(`excluding: ${alert.exclude}`)
  return parts.join(' · ')
}

/**
 * Free keyword alerts plus optional Pro smart filters. The panel says when
 * Telegram delivery or Pro access is missing, rather than pretending a filter
 * is active when it is not.
 */
export function AlertsPanel({
  alerts,
  telegramConfigured,
  telegramLinked,
  signedIn,
  canDeliver,
  proEnabled,
  trial,
  onChange,
  onLinkTelegram,
  onRequireSignIn,
  onOpenPlan,
}: AlertsPanelProps) {
  const initialParams =
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search)
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState(() => initialParams.get('q') ?? '')
  const [opportunityType, setOpportunityType] = useState<OpportunityFilter>(() =>
    initialParams.get('type') === 'gig' || initialParams.get('type') === 'job'
      ? (initialParams.get('type') as OpportunityFilter)
      : 'all',
  )
  const [kind, setKind] = useState<'keyword' | 'smart'>('keyword')
  const [smart, setSmart] = useState<SmartSettings>({})
  const [busy, setBusy] = useState(false)

  const add = () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel || (kind === 'smart' && !proEnabled)) return
    onChange([
      ...alerts,
      {
        id: crypto.randomUUID(),
        label: trimmedLabel,
        query: query.trim(),
        channels: ['telegram'],
        enabled: false,
        kind,
        opportunityType,
        ...(kind === 'smart' ? smart : {}),
      },
    ])
    setLabel('')
    setQuery('')
    setOpportunityType('all')
    setSmart({})
    setKind('keyword')
  }

  const update = (id: string, patch: Partial<AlertPreference>) => {
    onChange(alerts.map((alert) => (alert.id === id ? { ...alert, ...patch } : alert)))
  }

  const toggle = (alert: AlertPreference) => {
    if (!alert.enabled) {
      if (!signedIn) {
        onRequireSignIn()
        return
      }
      if (!canDeliver) return
    }
    update(alert.id, { enabled: !alert.enabled, channels: ['telegram'] })
  }

  const link = async () => {
    setBusy(true)
    try {
      await onLinkTelegram()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <p className="eyebrow">Free alerts stay free</p>
          <h2 className="panel__title">Job and gig alerts on Telegram</h2>
        </div>
        <div style={{ flex: 1 }} />
        <span className={`chip ${telegramLinked ? 'chip--ok' : 'chip--warn'}`}>
          {telegramLinked ? 'Telegram linked' : 'Not linked'}
        </span>
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          A free alert tells you when a new job, gig or contract matches your words. You can choose
          jobs, gigs and contracts, or all work free. With Pro, you can also choose a score,
          country, work setting, pay, companies and words to avoid.
        </p>

        {!signedIn ? (
          <div className="banner banner--info">
            <span>Sign in to receive job alerts.</span>
            <button type="button" className="btn btn--sm" onClick={onRequireSignIn}>
              Sign in
            </button>
          </div>
        ) : null}
        {!telegramConfigured ? (
          <div className="banner banner--demo">
            <Bell size={15} />
            <span>
              Telegram alerts aren’t connected yet. You can set up a search now and turn on delivery
              once the bot is ready.
            </span>
          </div>
        ) : null}

        {telegramConfigured && !telegramLinked ? (
          <div className="banner banner--info">
            <span>
              Connect Telegram, then tap Start in the bot chat. We’ll send you new jobs that match
              your search.
            </span>
          </div>
        ) : null}

        {telegramConfigured && signedIn && !telegramLinked ? (
          <div className="btnrow">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void link()}
              disabled={busy}
            >
              <Link2 size={13} /> Link Telegram
            </button>
          </div>
        ) : null}

        {alerts.length === 0 ? (
          <p className="panel__note">No alert preferences yet.</p>
        ) : (
          <div className="stack stack--sm">
            {alerts.map((alert) => (
              <article className="alert-card" key={alert.id}>
                <div className="alert-card-main">
                  <div>
                    <h3>{alert.label}</h3>
                    <p className="muted">
                      {alert.query ? `Watching: ${alert.query}` : 'Watching everything'}
                    </p>
                    {alert.kind === 'smart' && smartSummary(alert) ? (
                      <p className="field__hint">{smartSummary(alert)}</p>
                    ) : null}
                    {alert.kind === 'smart' && !proEnabled ? (
                      <p className="field__hint">
                        The extra filters are off because Pro is not on. The free alert still works.
                      </p>
                    ) : null}
                    <div className="chiprow">
                      <span className={`chip ${alert.enabled ? 'chip--ok' : 'chip--plain'}`}>
                        {alert.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="chip chip--plain">
                        {alert.kind === 'smart' ? 'Alert with filters' : 'Free alert'}
                      </span>
                      <span className="chip chip--plain">Telegram</span>
                      <span className="chip chip--plain">
                        {opportunityLabel(alert.opportunityType)}
                      </span>
                    </div>
                    <div style={{ maxWidth: 320, marginTop: 10 }}>
                      <OpportunityField
                        id={`alert-type-${alert.id}`}
                        value={alert.opportunityType ?? 'all'}
                        onChange={(value) => update(alert.id, { opportunityType: value })}
                      />
                    </div>
                  </div>
                  <div className="btnrow">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => toggle(alert)}
                      disabled={!alert.enabled && !canDeliver}
                      title={
                        !alert.enabled && !canDeliver
                          ? 'Sign in and connect Telegram to receive alerts'
                          : undefined
                      }
                    >
                      {alert.enabled ? 'Pause' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      aria-label={`Delete alert ${alert.label}`}
                      onClick={() => onChange(alerts.filter((item) => item.id !== alert.id))}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {alert.kind === 'smart' ? (
                  <details>
                    <summary>Edit filters</summary>
                    <SmartFields
                      prefix={alert.id}
                      settings={alert}
                      disabled={!proEnabled}
                      onPatch={(patch) => update(alert.id, patch)}
                    />
                    {!proEnabled ? (
                      <button className="btn btn--sm" type="button" onClick={onOpenPlan}>
                        {trial.status === 'not_started' ? 'Trial or buy Pro' : 'Buy Pro'}
                      </button>
                    ) : null}
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        )}

        <hr className="divider" />

        <div className="stack stack--sm">
          <h3>Create an alert</h3>
          <label className="field">
            Alert name
            <input
              id="alert-label"
              className="input"
              value={label}
              placeholder="Give it a name, e.g. My next design role"
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className="field">
            Keywords
            <input
              className="input"
              value={query}
              placeholder="e.g. python remote"
              onChange={(event) => setQuery(event.target.value)}
            />
            <small>Leave empty to watch every new listing. Every word must match.</small>
          </label>
          <OpportunityField
            id="alert-work-type"
            value={opportunityType}
            onChange={setOpportunityType}
          />
          <fieldset className="alert-kind">
            <legend>Alert type</legend>
            <label className="radio-card">
              <input
                type="radio"
                name="alert-kind"
                checked={kind === 'keyword'}
                onChange={() => setKind('keyword')}
              />
              <span>
                <strong>Free alert</strong>
                <small>Simple and always free.</small>
              </span>
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="alert-kind"
                checked={kind === 'smart'}
                onChange={() => setKind('smart')}
              />
              <span>
                <strong>Pro alert with filters</strong>
                <small>
                  {PRO_FREE_FOR_ALL
                    ? 'Included free during early access. Choose score, country, pay, company and words to avoid.'
                    : 'Choose score, country, pay, company and words to avoid.'}
                </small>
              </span>
            </label>
          </fieldset>

          {kind === 'smart' ? (
            <>
              {!proEnabled ? (
                <div className="locked-box">
                  <h4>Fewer, better alerts</h4>
                  <p>
                    Alerts with filters are in the free trial and Pro. Your free alerts will not
                    change.
                  </p>
                  <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
                    {trial.status === 'not_started' ? 'Trial or buy Pro' : 'Buy Pro'}
                  </button>
                </div>
              ) : null}
              <SmartFields
                prefix="new"
                settings={smart}
                disabled={!proEnabled}
                onPatch={(patch) => setSmart((current) => ({ ...current, ...patch }))}
              />
            </>
          ) : null}

          <div className="btnrow">
            <button
              type="button"
              className="btn btn--sm"
              onClick={add}
              disabled={!label.trim() || (kind === 'smart' && !proEnabled)}
            >
              <Plus size={13} /> Create alert
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
