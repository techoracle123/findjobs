import { useState } from 'react'
import { Bell, Link2, Plus, Trash2 } from 'lucide-react'
import type { AlertPreference } from '../shared/types'

interface AlertsPanelProps {
  alerts: AlertPreference[]
  telegramConfigured: boolean
  telegramLinked: boolean
  signedIn: boolean
  canDeliver: boolean
  onChange: (alerts: AlertPreference[]) => void
  onLinkTelegram: () => Promise<void>
  onRequireSignIn: () => void
}

/**
 * Alert preferences. Delivery needs a linked Telegram chat and an account
 * with the alerts entitlement; the panel states plainly which of those is
 * missing rather than showing a switch that quietly does nothing.
 */
export function AlertsPanel({
  alerts,
  telegramConfigured,
  telegramLinked,
  signedIn,
  canDeliver,
  onChange,
  onLinkTelegram,
  onRequireSignIn,
}: AlertsPanelProps) {
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const add = () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    onChange([
      ...alerts,
      {
        id: crypto.randomUUID(),
        label: trimmedLabel,
        query: query.trim(),
        channels: ['telegram'],
        enabled: false,
      },
    ])
    setLabel('')
    setQuery('')
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
      if (!canDeliver) {
        return
      }
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
        <h2 className="panel__title">Alerts</h2>
        <div style={{ flex: 1 }} />
        <span className={`chip ${telegramLinked ? 'chip--ok' : 'chip--warn'}`}>
          {telegramLinked ? 'Telegram linked' : 'Not linked'}
        </span>
      </div>
      <div className="panel__body">
        {!signedIn && (
          <div className="banner banner--info">
            <span>Sign in to receive job alerts.</span>
            <button type="button" className="btn btn--sm" onClick={onRequireSignIn}>
              Sign in
            </button>
          </div>
        )}
        {!telegramConfigured && (
          <div className="banner banner--demo">
            <Bell size={15} />
            <span>
              Telegram alerts aren’t connected yet. You can set up a search now and turn on delivery
              once the bot is ready.
            </span>
          </div>
        )}

        {telegramConfigured && !telegramLinked && (
          <div className="banner banner--info">
            <span>
              Connect Telegram, then tap Start in the bot chat. We’ll send you new jobs that match
              your search.
            </span>
          </div>
        )}

        {telegramConfigured && signedIn && !telegramLinked && (
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
        )}

        {alerts.length === 0 ? (
          <p className="panel__note">No alert preferences yet.</p>
        ) : (
          <div className="stack stack--sm">
            {alerts.map((alert) => (
              <div
                className="jobrow"
                key={alert.id}
                style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
              >
                <span className="jobrow__main">
                  <span className="jobrow__title">{alert.label}</span>
                  <span className="jobrow__company">
                    {alert.query ? `Watching: ${alert.query}` : 'Watching everything'}
                  </span>
                  <span className="jobrow__meta">
                    <span className={`chip ${alert.enabled ? 'chip--ok' : 'chip--plain'}`}>
                      {alert.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <span className="chip chip--plain">
                      {alert.channels.length > 0 ? alert.channels.join(', ') : 'no channel'}
                    </span>
                  </span>
                </span>
                <span className="jobrow__aside">
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
                    aria-label="Delete alert"
                    onClick={() => onChange(alerts.filter((item) => item.id !== alert.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <hr className="divider" />

        <div className="field">
          <label className="field__label" htmlFor="alert-label">
            New alert
          </label>
          <input
            id="alert-label"
            className="input"
            value={label}
            placeholder="Give it a name, e.g. My next design role"
            onChange={(event) => setLabel(event.target.value)}
          />
          <input
            className="input"
            value={query}
            aria-label="Alert keywords"
            placeholder="Keywords, e.g. python remote"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="btnrow">
            <button type="button" className="btn btn--sm" onClick={add} disabled={!label.trim()}>
              <Plus size={13} />
              Create alert
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
