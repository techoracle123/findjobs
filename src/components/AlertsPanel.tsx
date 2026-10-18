import { useState } from 'react'
import { Bell, Plus, Trash2 } from 'lucide-react'
import type { AlertPreference } from '../shared/types'

interface AlertsPanelProps {
  alerts: AlertPreference[]
  telegramConfigured: boolean
  onChange: (alerts: AlertPreference[]) => void
}

/**
 * Alert preferences are stored locally and are not connected to any delivery
 * channel. The panel is explicit about that so nobody mistakes a saved
 * preference for a working alert.
 */
export function AlertsPanel({ alerts, telegramConfigured, onChange }: AlertsPanelProps) {
  const [label, setLabel] = useState('')
  const [query, setQuery] = useState('')

  const add = () => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    onChange([
      ...alerts,
      {
        id: `alert-${Date.now()}`,
        label: trimmedLabel,
        query: query.trim(),
        channels: telegramConfigured ? ['telegram'] : [],
        enabled: false,
      },
    ])
    setLabel('')
    setQuery('')
  }

  const update = (id: string, patch: Partial<AlertPreference>) => {
    onChange(alerts.map((alert) => (alert.id === id ? { ...alert, ...patch } : alert)))
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Alerts</h2>
        <div style={{ flex: 1 }} />
        <span className="chip chip--warn">Not connected</span>
      </div>
      <div className="panel__body">
        <div className="banner banner--demo">
          <Bell size={15} />
          <span>
            No Telegram bot is configured in this preview, so nothing is delivered. These
            preferences are saved in your browser and are not sent anywhere.
          </span>
        </div>

        {alerts.length === 0 ? (
          <p className="panel__note">No alert preferences yet.</p>
        ) : (
          <div className="stack stack--sm">
            {alerts.map((alert) => (
              <div className="jobrow" key={alert.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span className="jobrow__main">
                  <span className="jobrow__title">{alert.label}</span>
                  <span className="jobrow__company">
                    {alert.query ? `Watching: ${alert.query}` : 'Watching everything'}
                  </span>
                  <span className="jobrow__meta">
                    <span className={`chip ${alert.enabled ? 'chip--ok' : 'chip--plain'}`}>
                      {alert.enabled ? 'Enabled (inert)' : 'Disabled'}
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
                    onClick={() => update(alert.id, { enabled: !alert.enabled })}
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
            placeholder="Label, e.g. Rust roles in Europe"
            onChange={(event) => setLabel(event.target.value)}
          />
          <input
            className="input"
            value={query}
            placeholder="Optional keyword filter"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="btnrow">
            <button type="button" className="btn btn--sm" onClick={add} disabled={!label.trim()}>
              <Plus size={13} />
              Add preference
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
