import { useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'
import type { PlanDefinition, Subscription } from '../lib/api'
import { currencySymbol } from '../shared/format'
import { copy } from '../shared/copy'

const COPY: Record<string, { features: string[]; cadence: string }> = {
  free: {
    cadence: 'forever',
    features: [
      'Browse the full feed',
      'Profile and skill fit scoring',
      'Save roles and track applications',
    ],
  },
  pro: {
    cadence: 'per month',
    features: ['Alerts to Telegram', 'Weekly digest', 'Verified source badges'],
  },
}

interface PlanPanelProps {
  signedIn: boolean
  billingEnabled: boolean
  plans: PlanDefinition[]
  subscription: Subscription | null
  entitlements: string[]
  onRefresh: () => Promise<void>
  onRequireSignIn: () => void
}

/**
 * Billing. The plan, the price and the currency come from the server, so
 * what is shown here is what would actually be charged. When a payment
 * provider is configured the checkout button starts a real checkout; when it
 * is not, the panel says so plainly rather than pretending.
 */
export function PlanPanel({
  signedIn,
  billingEnabled,
  plans,
  subscription,
  entitlements,
  onRefresh,
  onRequireSignIn,
}: PlanPanelProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const active = subscription && subscription.status === 'active' && !subscription.cancelAtPeriodEnd
  const isPro = Boolean(active && subscription.plan === 'pro')
  const ending = Boolean(subscription?.cancelAtPeriodEnd)

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
        // A provider with no portal of its own points back at this page.
        if (session.url.includes('billing=manage')) {
          setMessage('Manage your plan below.')
        } else {
          window.open(session.url, '_blank', 'noopener')
        }
      } else {
        const { session } = await startCheckout('pro')
        window.location.href = session.url
      }
    } catch {
      setMessage(copy('plan.failed'))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const { cancelSubscription } = await import('../lib/api')
      await cancelSubscription()
      await onRefresh()
      setMessage('Your plan will end at the close of the period you have already paid for.')
    } catch {
      setMessage(copy('plan.failed'))
    } finally {
      setBusy(false)
    }
  }

  const shown = plans.length > 0 ? plans : []

  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Plan</h2>
        <div style={{ flex: 1 }} />
        {isPro ? (
          <span className="chip chip--ok">Desk+ active</span>
        ) : ending ? (
          <span className="chip chip--plain">Ending</span>
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

        {ending && (
          <div className="banner banner--info">
            <span>
              Your Desk+ plan is set to end on{' '}
              {subscription?.currentPeriodEnd
                ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                : 'the next renewal'}{' '}
              and will not renew. Everything you have paid for stays available until then.
            </span>
          </div>
        )}

        <div className="skillsplit" style={{ gridTemplateColumns: '1fr' }}>
          {shown.map((plan) => {
            const copy = COPY[plan.id] ?? { features: [], cadence: 'per month' }
            const isCurrent = plan.id === 'pro' ? isPro : !isPro
            const price =
              plan.price.amount > 0
                ? `${currencySymbol(plan.price.currency)}${plan.price.amount.toLocaleString('en-US')}`
                : 'Free'
            return (
              <div key={plan.id} className="panel" style={{ boxShadow: 'none' }}>
                <div className="panel__body">
                  <div className="kv">
                    <span className="kv__key">
                      {plan.label}
                      {isCurrent && (
                        <span className="chip chip--plain" style={{ marginLeft: 8 }}>
                          current
                        </span>
                      )}
                    </span>
                    <span className="kv__value">
                      {price} <span style={{ color: 'var(--faint)' }}>{copy.cadence}</span>
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)', fontSize: 12.5 }}>
                    {copy.features.map((feature) => (
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
                      {isPro && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => void cancel()}
                          disabled={busy}
                        >
                          Cancel plan
                        </button>
                      )}
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
