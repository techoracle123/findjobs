import { useEffect, useState } from 'react'
import { Footer } from './Footer'

interface PlanRow {
  id: string
  label: string
  entitlements: string[]
  price: { amount: number; currency: string }
  interval: 'free' | 'month' | 'year' | 'waitlist'
  audience: 'seeker' | 'employer'
}

interface PlansPayload {
  plans: PlanRow[]
  currency: string
  billingEnabled: boolean
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  search: 'Search and browse opportunities',
  shortlist: 'Shortlist and application tracking',
  alerts: 'Job alerts',
  weekly_digest: 'Weekly digest',
  verified_source_badges: 'Verified source badges',
  cv_suggestions: 'CV tailoring suggestions',
  fast_apply: 'Fast Apply credits',
  unlimited_fast_apply: 'Unlimited Fast Apply where available',
  prepared_applications: 'Prepared applications',
  cv_check: 'CV check for each job',
  interview_prep: 'Interview preparation',
  salary_guide: 'Salary guide from real adverts',
}

/** Free for every job seeker on every plan; shown so the table tells the truth. */
const BASE_ROWS = ['search', 'shortlist']

const FAQ = [
  {
    q: 'Do I need a paid plan to find opportunities?',
    a: 'No. Search, shortlists and job alerts are free for everyone. Paid plans add prepared applications, a CV check for each job, interview preparation and a salary guide from real adverts.',
  },
  {
    q: 'Who is the Graduate plan for?',
    a: 'Recent graduates and NYSC members. Same Pro features at a lower monthly price.',
  },
  {
    q: 'How do I pay?',
    a: 'When billing opens, you pay through our payment partner. We never see or store your card details.',
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

function priceLine(plan: PlanRow): string {
  if (plan.interval === 'free' || plan.price.amount === 0) return 'Free'
  const amount = `₦${plan.price.amount.toLocaleString('en-NG')}`
  return plan.interval === 'year' ? `${amount} / year` : `${amount} / month`
}

/**
 * Pricing page (Prompt 17). The table is generated from the server's plan
 * catalogue — no price is hardcoded in the bundle. When billing is not
 * configured the page takes waitlist signups instead of showing a checkout
 * that cannot work.
 */
export function PricingPage() {
  const [plans, setPlans] = useState<PlansPayload | null>(null)
  const [waitlist, setWaitlist] = useState<'idle' | 'done' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [annual, setAnnual] = useState(false)

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

  const seekerPlans = (plans?.plans ?? []).filter((plan) => plan.audience === 'seeker')
  const columns = seekerPlans.filter((plan) =>
    annual
      ? plan.interval === 'free' || plan.interval === 'year'
      : plan.interval === 'free' || plan.interval === 'month',
  )
  const entitlementIds = Array.from(
    new Set(seekerPlans.flatMap((plan) => plan.entitlements)),
  ).filter((id) => id !== 'employer_interest')
  const hasAnnual = seekerPlans.some((plan) => plan.interval === 'year')

  return (
    <>
      <main className="wrap" id="main">
        <h1>Simple pricing</h1>
        <p className="lede">
          Finding opportunities is free, always. Job alerts are free too. Pay only when you want
          more help applying.
        </p>
        {plans && hasAnnual && (
          <div className="pricing-toggle" role="group" aria-label="Billing period">
            <button
              type="button"
              className="btn"
              aria-pressed={!annual}
              onClick={() => setAnnual(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={annual}
              onClick={() => setAnnual(true)}
            >
              Annual
            </button>
          </div>
        )}
        {plans && (
          <div className="table-wrap">
            <table className="table pricing-table">
              <thead>
                <tr>
                  <th scope="col">What you get</th>
                  {columns.map((plan) => (
                    <th scope="col" key={plan.id}>
                      {plan.label}
                      <br />
                      <span className="price-line">{priceLine(plan)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BASE_ROWS.map((id) => (
                  <tr key={id}>
                    <th scope="row">{ENTITLEMENT_LABELS[id] ?? id}</th>
                    {columns.map((plan) => (
                      <td key={plan.id}>Yes</td>
                    ))}
                  </tr>
                ))}
                {entitlementIds.map((id) => (
                  <tr key={id}>
                    <th scope="row">{ENTITLEMENT_LABELS[id] ?? id}</th>
                    {columns.map((plan) => (
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
            Paid plans are handled by our payment partner. You can cancel any time. Your shortlist
            and alerts stay free.
          </p>
        )}
        <section aria-label="For employers">
          <h2>Hiring?</h2>
          <p>
            Employer accounts and direct job posting are paused, so there is no employer price to
            pay. Vacancies on your public careers page or an established job board may be collected
            automatically at no cost.
          </p>
          <p>
            <a href="/employers">Read how this works or record employer interest</a>
          </p>
        </section>
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
