import { useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'
import type { Subscription } from '../lib/api'

const PLANS = [
  {
    id: 'free',
    name: 'Desk',
    price: 'Free',
    cadence: 'forever',
    features: [
      'Browse the full feed',
      'Profile and skill fit scoring',
      'Save roles and track applications',
    ],
  },
  {
    id: 'pro',
    name: 'Desk+',
    price: '$9',
    cadence: 'per month',
    features: ['Alerts to Telegram', 'Weekly digest', 'Verified source badges'],
  },
]

interface PlanPanelProps {
  signedIn: boolean
  billingEnabled: boolean
  subscription: Subscription | null
  entitlements: string[]
  onRefresh: () => Promise<void>
  onRequireSignIn: () => void
}

/**
 * Billing. When a payment provider is configured the checkout button starts
 * a real checkout; when it is not, the panel says so plainly rather than
 * pretending.
 */
export function PlanPanel({
  signedIn,
  billingEnabled,
  subscription,
  entitlements,
  onRefresh,
  onRequireSignIn,
}: PlanPanelProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const active = subscription && subscription.status === 'active' && !subscription.cancelAtPeriodEnd
  const isPro = Boolean(active && subscription.plan === 'pro')

  const subscribe = async () => {
    if (!signedIn) {
      onRequireSignIn()
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { openBillingPortal, startCheckout } = await import('../lib/api')
      if (isPro) {
        const { session } = await openBillingPortal()
        window.open(session.url, '_blank', 'noopener')
      } else {
        const { session } = await startCheckout('pro')
        window.location.href = session.url
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Plan</h2>
        <div style={{ flex: 1 }} />
        {isPro ? (
          <span className="chip chip--ok">Desk+ active</span>
        ) : (
          <span className="chip chip--plain">Desk</span>
        )}
      </div>
      <div className="panel__body">
        {!billingEnabled && (
          <div className="banner banner--demo">
            <CreditCard size={15} />
            <span>
              No payment provider is configured on this deployment, so checkout is unavailable.
              Nothing on this page will charge you.
            </span>
          </div>
        )}

        {subscription?.cancelAtPeriodEnd && (
          <div className="banner banner--info">
            <span>
              Your Desk+ plan is set to end on{' '}
              {subscription.currentPeriodEnd
                ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                : 'the next renewal'}{' '}
              and will not renew.
            </span>
          </div>
        )}

        <div className="skillsplit" style={{ gridTemplateColumns: '1fr' }}>
          {PLANS.map((plan) => {
            const isCurrent = plan.id === 'pro' ? isPro : !isPro
            return (
              <div key={plan.id} className="panel" style={{ boxShadow: 'none' }}>
                <div className="panel__body">
                  <div className="kv">
                    <span className="kv__key">
                      {plan.name}
                      {isCurrent && (
                        <span className="chip chip--plain" style={{ marginLeft: 8 }}>
                          current
                        </span>
                      )}
                    </span>
                    <span className="kv__value">
                      {plan.price} <span style={{ color: 'var(--faint)' }}>{plan.cadence}</span>
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)', fontSize: 12.5 }}>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>

                  {plan.id === 'pro' && (
                    <div className="btnrow">
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => void subscribe()}
                        disabled={busy || !billingEnabled}
                      >
                        {isPro ? (
                          <>
                            <ExternalLink size={13} /> Manage billing
                          </>
                        ) : (
                          'Choose Desk+'
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void onRefresh()}
                        disabled={busy}
                      >
                        Refresh status
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {entitlements.length > 0 && (
          <p className="panel__note">Active: {entitlements.join(', ').replace(/_/g, ' ')}.</p>
        )}
        {message && <p className="panel__note">{message}</p>}
      </div>
    </div>
  )
}
