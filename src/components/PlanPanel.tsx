import { CreditCard } from 'lucide-react'

const PLANS = [
  {
    id: 'free',
    name: 'Desk',
    price: 'Free',
    cadence: 'forever',
    features: ['Browse the preview feed', 'Profile and skill fit', 'Save roles in this browser'],
  },
  {
    id: 'pro',
    name: 'Desk+',
    price: '$9',
    cadence: 'per month',
    features: ['Alerts to Telegram', 'Weekly digest', 'Verified source badges'],
  },
]

/**
 * Billing is a preview. No payment provider is connected and the checkout
 * button is deliberately inert.
 */
export function PlanPanel() {
  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Plan</h2>
        <div style={{ flex: 1 }} />
        <span className="chip chip--warn">Preview only</span>
      </div>
      <div className="panel__body">
        <div className="banner banner--demo">
          <CreditCard size={15} />
          <span>
            No payment provider is connected. Nothing on this page charges you, and the checkout
            button below does nothing.
          </span>
        </div>

        <div className="skillsplit" style={{ gridTemplateColumns: '1fr' }}>
          {PLANS.map((plan) => (
            <div key={plan.id} className="panel" style={{ boxShadow: 'none' }}>
              <div className="panel__body">
                <div className="kv">
                  <span className="kv__key">{plan.name}</span>
                  <span className="kv__value">
                    {plan.price} <span style={{ color: 'var(--faint)' }}>{plan.cadence}</span>
                  </span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)', fontSize: 12.5 }}>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <button type="button" className="btn btn--sm" disabled>
                  Checkout unavailable
                </button>
              </div>
            </div>
          ))}
        </div>

        <p className="panel__note">
          Before any paid launch this needs a real provider, verified webhooks, subscription
          entitlements, and cancellation and refund handling.
        </p>
      </div>
    </div>
  )
}
