import { useEffect, useState } from 'react'
import { Footer } from './Footer'

interface PlanRow {
  id: string
  label: string
  entitlements: string[]
  price: { amount: number; currency: string }
}

interface PlansPayload {
  plans: PlanRow[]
  currency: string
  billingEnabled: boolean
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  search: 'Search and browse opportunities',
  shortlist: 'Shortlist and application tracking',
  alerts: 'Free email alerts',
  weekly_digest: 'Weekly digest',
  verified_source_badges: 'Verified source badges',
  cv_suggestions: 'CV tailoring suggestions',
  fast_apply: 'Fast Apply credits',
}

const FAQ = [
  {
    q: 'Do I need a paid plan to find opportunities?',
    a: 'No. Search, shortlists and free alerts are free. Paid plans add CV tailoring and Fast Apply credits.',
  },
  {
    q: 'How do I pay?',
    a: 'When billing opens, you pay through our payment partner, Bachs. We never see or store your card details.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes. You can cancel at any time from your account page. Your current period stays active until it ends.',
  },
  {
    q: 'What currency are prices in?',
    a: 'Prices are shown in naira. Bills settle in naira through our payment partner.',
  },
]

/**
 * Pricing page (Prompt 17). The table is generated from the server's
 * entitlement configuration — no price is hardcoded in the bundle. When
 * billing is not configured the page takes waitlist signups instead of
 * showing a checkout that cannot work.
 */
export function PricingPage() {
  const [plans, setPlans] = useState<PlansPayload | null>(null)
  const [waitlist, setWaitlist] = useState<'idle' | 'done' | 'error'>('idle')
  const [email, setEmail] = useState('')

  useEffect(() => {
    document.title = 'Pricing — FJ - Find Jobs'
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const link = canonical ?? Object.assign(document.createElement('link'), { rel: 'canonical' })
    link.href = 'https://fj-find-jobs.pages.dev/pricing'
    if (!canonical) document.head.appendChild(link)
    void fetch('/api/billing/plans', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<PlansPayload>) : null))
      .then((body: PlansPayload | null) => {
        if (body) setPlans(body)
      })
      .catch(() => {})
  }, [])

  const entitlementIds = Array.from(
    new Set((plans?.plans ?? []).flatMap((plan) => plan.entitlements)),
  )

  return (
    <>
      <main className="wrap" id="main">
        <h1>Simple pricing</h1>
        <p className="lede">
          Finding opportunities is free, always. Pay only when you want more help applying.
        </p>
        {plans && (
          <div className="table-wrap">
            <table className="table pricing-table">
              <thead>
                <tr>
                  <th scope="col">What you get</th>
                  {plans.plans.map((plan) => (
                    <th scope="col" key={plan.id}>
                      {plan.label}
                      <br />
                      <span className="price-line">
                        {plan.price.amount === 0
                          ? 'Free'
                          : `₦${plan.price.amount.toLocaleString('en-NG')} / month`}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entitlementIds.map((id) => (
                  <tr key={id}>
                    <th scope="row">{ENTITLEMENT_LABELS[id] ?? id}</th>
                    {plans.plans.map((plan) => (
                      <td key={plan.id}>{plan.entitlements.includes(id) ? 'Yes' : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {plans && !plans.billingEnabled && (
          <section className="waitlist" aria-label="Waitlist">
            <h2>Payments are not open yet</h2>
            <p>
              We are still setting up payments. Leave your email and we will tell you when paid
              plans open. You do not need a card now.
            </p>
            {waitlist === 'done' ? (
              <p role="status">Thank you. We will email you when paid plans open.</p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void fetch('/api/billing/waitlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                  })
                    .then((r) => {
                      if (!r.ok) throw new Error('failed')
                      setWaitlist('done')
                    })
                    .catch(() => setWaitlist('error'))
                }}
              >
                <label className="field">
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                  />
                </label>
                <button className="btn btn--primary">Tell me when it opens</button>
                {waitlist === 'error' && (
                  <p className="banner banner--demo" role="status">
                    Could not save that just now. Try again.
                  </p>
                )}
              </form>
            )}
          </section>
        )}
        {plans && plans.billingEnabled && (
          <p>
            Paid plans are handled by our payment partner, Bachs. You can cancel any time. Your
            shortlist and alerts stay free.
          </p>
        )}
        <section aria-label="Pricing questions">
          <h2>Common questions</h2>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </section>
        <p className="field__hint">
          FJ is not an employer. We do not own, verify or endorse any listing, and we never
          guarantee employment. Always check the original post yourself. Never pay anyone for a job
          or an application.
        </p>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: FAQ.map((item) => ({
                '@type': 'Question',
                name: item.q,
                acceptedAnswer: { '@type': 'Answer', text: item.a },
              })),
            }),
          }}
        />
      </main>
      <Footer />
    </>
  )
}
