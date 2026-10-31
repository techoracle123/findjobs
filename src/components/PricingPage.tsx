import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Footer } from './Footer'
import {
  fetchProAccess,
  startProTrial,
  submitGraduateEligibility,
  type ProAccess,
} from '../lib/api'
import type { GraduateEligibilityInput, GraduateEligibilityState } from '../shared/types'
import { FREE_FEATURES, PRO_FEATURES, PRO_LIMITS } from '../lib/pro-features'

interface PlanRow {
  id: string
  label: string
  displayLabel?: string
  entitlements: string[]
  price: { amount: number; currency: string }
  interval: 'free' | 'month' | 'year' | 'waitlist'
  audience: 'seeker' | 'employer'
  monthlyEquivalent?: number
  founding?: boolean
  standardAmount?: number
  trialDays?: number
}

interface PlansPayload {
  plans: PlanRow[]
  currency: string
  billingEnabled: boolean
}

const FAQ = [
  {
    q: 'Do I have to pay to apply for a job?',
    a: 'No. Search, opening jobs and applying on the employer’s own website are free and unlimited. Pro never puts an application button behind a paywall.',
  },
  {
    q: 'What does the 3-day free trial include?',
    a: 'Every Pro tool for 72 hours, including one full CV analysis and complete application packs for three jobs. That three-job allowance is shared: the first application pack or detailed CV-to-job check for a new job uses one. Using both for the same job, or regenerating that job’s pack, does not use another. No card is taken, so the trial simply ends by itself.',
  },
  {
    q: 'Are Pro Monthly and Pro Yearly different?',
    a: 'No. They include exactly the same tools. Yearly simply costs less over the year.',
  },
  {
    q: 'Who can use Pro for Graduates?',
    a: 'Final-year students, people who finished tertiary education within the last 24 months, current corps members, and people who finished NYSC within the last 12 months — provided you have under two years of full-time paid work.',
  },
  {
    q: 'How is the graduate price checked?',
    a: 'You answer month-and-year questions and make a declaration. FJ also checks whether the answers conflict with your profile or CV. Clear cases are decided automatically. Conflicts go to review. FJ does not ask for your age, BVN or NIN.',
  },
  {
    q: 'What CV does FJ save?',
    a: 'Free CV import reads the file on your device for basic suggestions. Pro is different: only after you give permission, FJ saves the readable text and analysis report. The original PDF or DOCX file is not kept. You can download or delete the saved text from your account.',
  },
  {
    q: 'Will FJ write experience into my CV?',
    a: 'No. FJ never adds an employer, qualification, date, tool, project or number that is not in your information. Weak bullets are shown as evidence-based starting points for you to make true and specific.',
  },
  {
    q: 'Does the advert check mean an employer is verified?',
    a: 'No. It shows what the advert itself says about Nigeria eligibility and visible warning signs such as fees, personal-document requests or messaging-only contact. No warning signs found is not approval. Always check the employer independently.',
  },
  {
    q: 'Does FJ apply for me or guarantee an interview?',
    a: 'No. FJ prepares your application and helps you choose suitable roles. You review everything and apply yourself on the employer’s site. Nobody can honestly guarantee an interview or a job.',
  },
  {
    q: 'When can I pay?',
    a: 'Card and bank-transfer payments are the next stage. Until then, prices are shown clearly and the free trial is available, but no payment is taken. Join the email list below to hear when payments open.',
  },
  {
    q: 'What is the founding price?',
    a: 'The first 500 people who pay will get Pro Monthly at ₦5,000 or Pro Yearly at ₦40,000, locked for 12 months. After that cohort, the standard prices will be ₦10,000 monthly and ₦60,000 yearly. Pro for Graduates is ₦3,000 monthly.',
  },
]

const USE_CASES = [
  {
    title: 'You keep applying and hear nothing',
    text: 'Start with the detailed CV analysis, then compare your CV with each exact advert before you send another general application.',
  },
  {
    title: 'You want remote work from Nigeria',
    text: 'Use the before-you-apply check to see whether Nigeria is actually eligible, what work-authorisation words say, and whether time-zone limits are stated.',
  },
  {
    title: 'You are a fresh graduate or corps member',
    text: 'Turn NYSC, internships, SIWES, volunteer work and projects into clearer evidence — then use the repeated skill-gap plan to decide what to build next.',
  },
  {
    title: 'You see job adverts on WhatsApp or Telegram',
    text: 'Paste the advert before you send documents or money. The check highlights fees, ID requests, messaging-only contact and other visible danger signs.',
  },
  {
    title: 'You are only browsing occasionally',
    text: 'Stay on Free. Search, save jobs, use basic alerts and apply on employer sites without spending anything.',
  },
]

function money(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

function priceLine(plan: PlanRow): string {
  if (plan.interval === 'free' || plan.price.amount === 0) return 'Free forever'
  return `${money(plan.price.amount)} / ${plan.interval === 'year' ? 'year' : 'month'}`
}

interface GraduateForm {
  status: string
  educationMonth: string
  nyscMonth: string
  fullTimeExperience: string
  declared: boolean
}

const EMPTY_GRADUATE: GraduateForm = {
  status: '',
  educationMonth: '',
  nyscMonth: '',
  fullTimeExperience: '',
  declared: false,
}

/**
 * Pricing and product education. Prices come from the server catalogue; the
 * trial and graduate check work now, while real-money checkout opens later.
 */
export function PricingPage() {
  const [plans, setPlans] = useState<PlansPayload | null>(null)
  const [access, setAccess] = useState<ProAccess | null>(null)
  const [trialBusy, setTrialBusy] = useState(false)
  const [trialNotice, setTrialNotice] = useState('')
  const [waitlist, setWaitlist] = useState<'idle' | 'done' | 'error'>('idle')
  const [email, setEmail] = useState('')
  const [graduateForm, setGraduateForm] = useState<GraduateForm>(EMPTY_GRADUATE)
  const [graduateResult, setGraduateResult] = useState<GraduateEligibilityState | null>(null)
  const [graduateBusy, setGraduateBusy] = useState(false)
  const [graduateError, setGraduateError] = useState('')

  useEffect(() => {
    document.title = 'Pricing — FJ - Find Jobs'
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    const link = canonical ?? Object.assign(document.createElement('link'), { rel: 'canonical' })
    link.href = 'https://fj-find-jobs.pages.dev/pricing'
    if (!canonical) document.head.appendChild(link)
    void fetch('/api/billing/plans', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<PlansPayload>) : null))
      .then((body) => body && setPlans(body))
      .catch(() => {})
    void fetchProAccess()
      .then((body) => {
        setAccess(body)
        setGraduateResult(body.graduate)
        if (body.graduate) {
          setGraduateForm({
            status: body.graduate.status,
            educationMonth: body.graduate.educationMonth ?? '',
            nyscMonth: body.graduate.nyscMonth ?? '',
            fullTimeExperience: body.graduate.fullTimeExperience,
            declared: body.graduate.declared,
          })
        }
      })
      .catch(() => setAccess(null))
  }, [])

  const seekerPlans = useMemo(
    () => (plans?.plans ?? []).filter((plan) => plan.audience === 'seeker'),
    [plans],
  )

  const startTrial = async () => {
    setTrialBusy(true)
    setTrialNotice('')
    try {
      const result = await startProTrial()
      const next = await fetchProAccess().catch(() => null)
      if (next) setAccess(next)
      setTrialNotice(
        result.trial.status === 'active'
          ? 'Your 3-day Pro trial is active. Go to your dashboard to analyse your CV or open a job and prepare an application.'
          : 'Your one free trial has already been used. Free job search and applications continue.',
      )
    } catch {
      setTrialNotice('The trial could not be started just now. Please try again.')
    } finally {
      setTrialBusy(false)
    }
  }

  const submitGraduate = async (event: FormEvent) => {
    event.preventDefault()
    setGraduateBusy(true)
    setGraduateError('')
    try {
      const input: GraduateEligibilityInput = {
        status: graduateForm.status as GraduateEligibilityInput['status'],
        educationMonth: graduateForm.educationMonth || null,
        nyscMonth: graduateForm.nyscMonth || null,
        fullTimeExperience:
          graduateForm.fullTimeExperience as GraduateEligibilityInput['fullTimeExperience'],
        declared: graduateForm.declared,
      }
      const result = await submitGraduateEligibility(input)
      setGraduateResult(result.graduate)
    } catch {
      setGraduateError('The graduate check could not be completed just now. Please try again.')
    } finally {
      setGraduateBusy(false)
    }
  }

  const needsEducationMonth = [
    'final_year',
    'recent_graduate',
    'nysc_current',
    'nysc_recent',
  ].includes(graduateForm.status)
  const needsNyscMonth = ['nysc_current', 'nysc_recent'].includes(graduateForm.status)

  return (
    <>
      <main className="wrap pricing-page" id="main">
        <p className="eyebrow">Pricing in plain English</p>
        <h1>Free to find and apply. Pro to apply stronger.</h1>
        <p className="lede">
          FJ never charges you to see a public job or apply on the employer’s own website. Pro is
          for the work around the application: checking your CV against real adverts, preparing a
          stronger pack, avoiding unsuitable or suspicious roles, and following through.
        </p>

        <section className="pricing-hero-card" aria-labelledby="trial-heading">
          <div>
            <p className="eyebrow">No card needed</p>
            <h2 id="trial-heading">Try Pro free for 3 days</h2>
            <p>
              One full CV analysis, three complete application packs, advert checks, best matches,
              smart alerts, salary evidence and interview preparation. It ends automatically.
            </p>
          </div>
          {access ? (
            access.paid ? (
              <a className="btn btn--primary merge-cta" href="/dashboard?tab=plan">
                Pro is active — open your plan
              </a>
            ) : access.trial.status === 'active' ? (
              <a className="btn btn--primary merge-cta" href="/dashboard?tab=plan">
                Trial active — open your Pro tools
              </a>
            ) : access.trial.status === 'not_started' ? (
              <button
                className="btn btn--primary merge-cta"
                type="button"
                disabled={trialBusy}
                onClick={() => void startTrial()}
              >
                {trialBusy ? 'Starting…' : 'Start my free 3-day trial'}
              </button>
            ) : (
              <a className="btn btn--primary merge-cta" href="#payments-opening-soon">
                Trial used — join the payment-opening list
              </a>
            )
          ) : (
            <a className="btn btn--primary merge-cta" href="/auth/signup?returnTo=%2Fpricing">
              Create a free account to start the trial
            </a>
          )}
          {trialNotice ? (
            <p className="form-notice" role="status">
              {trialNotice}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading">Choose how long you want the tools</h2>
          <p>
            Monthly, Yearly and Graduate are the same Pro service. Only the price and who can use it
            are different.
          </p>
          <div className="pricing-cards">
            {seekerPlans.map((plan) => (
              <article
                className={`pricing-card ${plan.id === 'pro_annual' ? 'pricing-card-featured' : ''}`}
                key={plan.id}
              >
                <p className="eyebrow">{plan.displayLabel ?? plan.label}</p>
                <p className="pricing-card-price">{priceLine(plan)}</p>
                {plan.monthlyEquivalent && plan.interval === 'year' ? (
                  <p className="muted">About {money(Math.round(plan.monthlyEquivalent))} a month</p>
                ) : null}
                {plan.founding && plan.standardAmount && plan.standardAmount > plan.price.amount ? (
                  <p>
                    <strong>Founding price</strong> for the first 500 paying members, locked for 12
                    months. Later standard price: {money(plan.standardAmount)}.
                  </p>
                ) : null}
                {plan.id === 'free' ? (
                  <p>Search, save, alert and apply on employer sites. No card and no time limit.</p>
                ) : plan.id === 'pro_graduate' ? (
                  <p>
                    Same Pro tools at a lower monthly price for people who pass the graduate check
                    below.
                  </p>
                ) : plan.interval === 'year' ? (
                  <p>
                    Best value if you expect a longer job search or want the tools ready all year.
                  </p>
                ) : (
                  <p>Flexible month-by-month access while you are actively applying.</p>
                )}
              </article>
            ))}
          </div>
          {!plans ? <p role="status">Loading current prices…</p> : null}
        </section>

        <section aria-labelledby="use-case-heading">
          <h2 id="use-case-heading">Is Pro worth it for you?</h2>
          <div className="pricing-use-cases">
            {USE_CASES.map((item) => (
              <article key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="compare-heading">
          <h2 id="compare-heading">Everything included</h2>
          <div className="table-wrap">
            <table className="table pricing-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Free</th>
                  <th scope="col">3-day trial</th>
                  <th scope="col">Pro</th>
                </tr>
              </thead>
              <tbody>
                {FREE_FEATURES.map((feature) => (
                  <tr key={feature.id}>
                    <th scope="row">
                      {feature.title}
                      <span>{feature.what}</span>
                    </th>
                    <td>Yes</td>
                    <td>Yes</td>
                    <td>Yes</td>
                  </tr>
                ))}
                {PRO_FEATURES.map((feature) => (
                  <tr key={feature.id}>
                    <th scope="row">
                      {feature.title}
                      <span>{feature.what}</span>
                    </th>
                    <td>—</td>
                    <td>
                      {feature.id === 'cv_analysis'
                        ? '1 analysis'
                        : feature.id === 'prepared_applications' || feature.id === 'cv_check'
                          ? '3 jobs, shared'
                          : 'Yes'}
                    </td>
                    <td>Yes</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="pricing-feature-detail" aria-labelledby="pro-detail-heading">
          <h2 id="pro-detail-heading">What each Pro tool actually does</h2>
          {PRO_FEATURES.map((feature) => (
            <details key={feature.id}>
              <summary>{feature.title}</summary>
              <p>{feature.what}</p>
              <p>
                <strong>Why it matters:</strong> {feature.why}
              </p>
            </details>
          ))}
        </section>

        <section className="graduate-check" aria-labelledby="graduate-heading">
          <h2 id="graduate-heading">Check the ₦3,000 graduate price</h2>
          <p>
            Pro for Graduates is for final-year students, recent graduates and current or recent
            corps members with under two years of full-time paid work. It contains exactly the same
            Pro tools.
          </p>
          {!access ? (
            <p>
              <a className="btn btn--primary" href="/auth/signup?returnTo=%2Fpricing">
                Create a free account to check
              </a>{' '}
              You can also sign in if you already have an account.
            </p>
          ) : (
            <form onSubmit={(event) => void submitGraduate(event)}>
              <div className="form-grid">
                <label className="field">
                  Which best describes you?
                  <select
                    required
                    value={graduateForm.status}
                    onChange={(event) =>
                      setGraduateForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose one</option>
                    <option value="final_year">I am in my final year</option>
                    <option value="recent_graduate">I recently finished school</option>
                    <option value="nysc_current">I am currently serving (NYSC)</option>
                    <option value="nysc_recent">I recently finished NYSC</option>
                    <option value="worker">None of these</option>
                  </select>
                </label>
                <label className="field">
                  Full-time paid work since school
                  <select
                    required
                    value={graduateForm.fullTimeExperience}
                    onChange={(event) =>
                      setGraduateForm((current) => ({
                        ...current,
                        fullTimeExperience: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose one</option>
                    <option value="none">None</option>
                    <option value="under_1_year">Under 1 year</option>
                    <option value="1_to_2_years">1 year to under 2 years</option>
                    <option value="over_2_years">2 years or more</option>
                  </select>
                </label>
                {needsEducationMonth ? (
                  <label className="field">
                    Month you finished or expect to finish
                    <input
                      type="month"
                      required
                      value={graduateForm.educationMonth}
                      onChange={(event) =>
                        setGraduateForm((current) => ({
                          ...current,
                          educationMonth: event.target.value,
                        }))
                      }
                    />
                  </label>
                ) : null}
                {needsNyscMonth ? (
                  <label className="field">
                    NYSC completion month
                    <input
                      type="month"
                      value={graduateForm.nyscMonth}
                      onChange={(event) =>
                        setGraduateForm((current) => ({
                          ...current,
                          nyscMonth: event.target.value,
                        }))
                      }
                    />
                    <small>For current corps members, use the expected completion month.</small>
                  </label>
                ) : null}
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={graduateForm.declared}
                  onChange={(event) =>
                    setGraduateForm((current) => ({ ...current, declared: event.target.checked }))
                  }
                />{' '}
                I confirm these answers are true. I understand FJ may ask for proof before the
                graduate price is used.
              </label>
              <button className="btn btn--primary" type="submit" disabled={graduateBusy}>
                {graduateBusy ? 'Checking…' : 'Check my graduate price'}
              </button>
              {graduateError ? (
                <p className="banner banner--demo" role="alert">
                  {graduateError}
                </p>
              ) : null}
            </form>
          )}
          {graduateResult ? (
            <div className="graduate-result" role="status">
              <h3>
                {graduateResult.result === 'eligible'
                  ? 'You qualify for Pro for Graduates'
                  : graduateResult.result === 'review'
                    ? 'Your check needs review'
                    : 'The graduate price does not apply'}
              </h3>
              <ul className="plain-list">
                {graduateResult.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
                {graduateResult.flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
              <p>
                {graduateResult.result === 'eligible'
                  ? 'When payments open, your price will be ₦3,000 a month for the full Pro service. You can start the free 3-day trial now.'
                  : graduateResult.result === 'review'
                    ? 'Do not send BVN, NIN or a full identity document. FJ will tell you exactly what acceptable proof is needed before payment opens.'
                    : 'Regular Pro Monthly and Pro Yearly contain the same tools.'}
              </p>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="limits-heading">
          <h2 id="limits-heading">What Pro does not do</h2>
          <ul className="plain-list">
            {PRO_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </section>

        {plans && !plans.billingEnabled ? (
          <section
            className="waitlist"
            id="payments-opening-soon"
            aria-label="Payments opening soon"
          >
            <h2>Payments open in the next stage</h2>
            <p>
              Card and bank-transfer checkout is being prepared. No money is taken today. Leave your
              email and we will tell you when the founding prices can be claimed.
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
                <button className="btn btn--primary">Tell me when payments open</button>
                {waitlist === 'error' ? (
                  <p className="banner banner--demo" role="status">
                    Could not save that just now. Try again.
                  </p>
                ) : null}
              </form>
            )}
          </section>
        ) : null}

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
