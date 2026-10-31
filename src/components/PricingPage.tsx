import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Check, ShieldCheck } from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'
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
    a: 'No. You can search jobs, open jobs and apply on the company website for free. There is no limit.',
  },
  {
    q: 'What do I get in the free trial?',
    a: 'You get all Pro tools for 3 days. You can check one CV in full. You can prepare applications for three jobs. If you compare your CV with a new job first, that job counts as one of the three. You can prepare the same job again without using another one. We do not ask for card details.',
  },
  {
    q: 'Are Pro Monthly and Pro Yearly different?',
    a: 'No. The tools are the same. Yearly costs less for each month.',
  },
  {
    q: 'Who can use Pro for Graduates?',
    a: 'You must be in final year, have finished school in the last 24 months, be serving now, or have finished NYSC in the last 12 months. You must also have less than two years of full time paid work.',
  },
  {
    q: 'How do you check the graduate price?',
    a: 'You give the month and year for school or NYSC. You also confirm that your answers are true. FJ checks if the answers match your profile or CV. Clear answers get a result at once. Answers that do not match need a review. We do not ask for your age, BVN or NIN.',
  },
  {
    q: 'What happens to my CV?',
    a: 'The free CV tool reads your file on your device. It does not save the file. For the Pro CV check, FJ saves the text from your CV only if you agree. FJ does not keep the PDF or DOCX file. You can see, download, replace or delete the saved text.',
  },
  {
    q: 'Will FJ add things to my CV?',
    a: 'No. FJ will not add a company, school, date, tool, project or number that is not in your details.',
  },
  {
    q: 'Does the advert check mean the company is safe?',
    a: 'No. The check shows what the advert says. It can show warning signs such as a request for money or personal documents. It does not approve a company. Check the company yourself.',
  },
  {
    q: 'Will FJ apply for me?',
    a: 'No. FJ helps you prepare. You read the work, make changes if you need to, and apply on the company website. FJ does not promise an interview or a job.',
  },
  {
    q: 'When can I pay?',
    a: 'Payments are not open yet. We are setting up card and bank transfer payments. You can use Free now and try Pro free for 3 days.',
  },
  {
    q: 'What is the first price?',
    a: 'The first 500 people who pay can use Pro Monthly for ₦5,000 or Pro Yearly for ₦40,000. That price stays the same for 12 months. The later price will be ₦10,000 each month or ₦60,000 each year. Pro for Graduates is ₦3,000 each month.',
  },
]

const PLAN_ORDER = ['free', 'pro', 'pro_annual', 'pro_graduate']

const PLAN_POINTS: Record<string, string[]> = {
  free: ['Search all jobs', 'Apply free', 'Save jobs', 'Free Telegram alerts'],
  pro: ['All Pro tools', 'Check your CV', 'Prepare applications', 'Pay each month'],
  pro_annual: ['All Pro tools', 'Check your CV', 'Prepare applications', 'Lower cost each month'],
  pro_graduate: [
    'All Pro tools',
    'Lower monthly price',
    'For people who qualify',
    'Check before you pay',
  ],
}

function money(amount: number): string {
  return `₦${amount.toLocaleString('en-NG')}`
}

function planName(plan: PlanRow): string {
  return plan.displayLabel ?? plan.label
}

function planIntro(plan: PlanRow): string {
  if (plan.id === 'free') return 'For finding jobs and applying.'
  if (plan.id === 'pro_graduate')
    return 'For students, new graduates and corps members who qualify.'
  if (plan.interval === 'year') return 'For a longer job search.'
  return 'For a short job search.'
}

function IncludedMark() {
  return (
    <span className="pricing-check" aria-label="Included">
      <Check size={17} aria-hidden="true" />
      <span className="visually-hidden">Included</span>
    </span>
  )
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
 * Prices, the free trial and the graduate check. Real payments are not open
 * yet, so nothing on this page takes money from a user.
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
    document.title = 'Pricing. FJ Find Jobs'
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
    () =>
      (plans?.plans ?? [])
        .filter((plan) => plan.audience === 'seeker')
        .sort((a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id)),
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
          ? 'Your free trial is on. Go to your dashboard to check your CV. You can also open a job and prepare your application.'
          : 'You have used your free trial. You can still search and apply for free.',
      )
    } catch {
      setTrialNotice('We could not start the trial. Please try again.')
    } finally {
      setTrialBusy(false)
    }
  }

  const trialAction = (className = 'btn btn--primary pricing-main-cta') => {
    if (!access) {
      return (
        <a className={className} href="/auth/signup?returnTo=%2Fpricing">
          Create a free account
        </a>
      )
    }
    if (access.paid) {
      return (
        <a className={className} href="/dashboard?tab=plan">
          Open your plan
        </a>
      )
    }
    if (access.trial.status === 'active') {
      return (
        <a className={className} href="/dashboard?tab=plan">
          Open Pro tools
        </a>
      )
    }
    if (access.trial.status === 'not_started') {
      return (
        <button
          className={className}
          type="button"
          disabled={trialBusy}
          onClick={() => void startTrial()}
        >
          {trialBusy ? 'Starting...' : 'Start free trial'}
        </button>
      )
    }
    return (
      <a className={className} href="#payments-opening-soon">
        Join the list
      </a>
    )
  }

  const planAction = (plan: PlanRow) => {
    if (plan.id === 'free') {
      return access
        ? { href: '/jobs', label: 'See jobs' }
        : { href: '/auth/signup?returnTo=%2Fjobs', label: 'Create free account' }
    }
    if (plan.id === 'pro_graduate') {
      return { href: '#graduate-check', label: 'Check if you qualify' }
    }
    if (access?.paid) return { href: '/dashboard?tab=plan', label: 'Open your plan' }
    if (access?.trial.status === 'active') {
      return { href: '/dashboard?tab=plan', label: 'Open Pro tools' }
    }
    if (access?.trial.status === 'not_started') return { href: '#trial', label: 'Try Pro free' }
    if (access) return { href: '#payments-opening-soon', label: 'Join the list' }
    return { href: '/auth/signup?returnTo=%2Fpricing', label: 'Create free account' }
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
      setGraduateError('We could not finish the check. Please try again.')
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
    <div className="app pricing-shell">
      <SiteHeader current="pricing" />
      <main className="wrap pricing-page" id="main">
        <section className="pricing-hero" aria-labelledby="pricing-heading">
          <p className="eyebrow">Pricing</p>
          <h1 id="pricing-heading">Simple pricing</h1>
          <p className="lede">
            Finding a job and applying are free. Pro helps you check your CV, check the advert and
            prepare your application.
          </p>
          <div className="pricing-hero-actions">
            {trialAction()}
            <a className="btn pricing-secondary-cta" href="#compare">
              Compare plans
            </a>
          </div>
          {trialNotice ? (
            <p className="form-notice pricing-hero-notice" role="status">
              {trialNotice}
            </p>
          ) : null}
          <ul className="pricing-points" aria-label="Good to know">
            <li>
              <Check size={16} aria-hidden="true" /> Applying stays free
            </li>
            <li>
              <Check size={16} aria-hidden="true" /> No card for the trial
            </li>
            <li>
              <Check size={16} aria-hidden="true" /> Payments are not open yet
            </li>
          </ul>
          <nav className="pricing-quick-links" aria-label="On this page">
            <a href="#plans">Plans</a>
            <a href="#compare">Compare</a>
            <a href="#graduate-check">Graduate price</a>
            <a href="#questions">Questions</a>
          </nav>
        </section>

        <section className="pricing-hero-card" id="trial" aria-labelledby="trial-heading">
          <div>
            <p className="eyebrow">Free trial</p>
            <h2 id="trial-heading">Try Pro free for 3 days</h2>
            <ul className="pricing-trial-list">
              <li>
                <Check size={16} aria-hidden="true" /> Check one CV in full
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> Prepare applications for three jobs
              </li>
              <li>
                <Check size={16} aria-hidden="true" /> The trial ends on its own
              </li>
            </ul>
          </div>
          <div className="pricing-trial-action">
            {trialAction('btn btn--primary pricing-main-cta')}
            <p>No card details. No charge.</p>
          </div>
        </section>

        <section id="plans" aria-labelledby="plans-heading">
          <div className="pricing-section-head">
            <div>
              <p className="eyebrow">Plans</p>
              <h2 id="plans-heading">Choose a plan</h2>
            </div>
            <p>Pro Monthly, Pro Yearly and Pro for Graduates have the same tools.</p>
          </div>

          <div className="pricing-cards">
            {seekerPlans.map((plan) => {
              const action = planAction(plan)
              const featured = plan.id === 'pro_annual'
              return (
                <article
                  className={`pricing-card ${featured ? 'pricing-card-featured' : ''} ${
                    plan.id === 'pro_graduate' ? 'pricing-card-graduate' : ''
                  }`}
                  key={plan.id}
                >
                  {featured ? <span className="pricing-badge">Best value</span> : null}
                  {plan.id === 'pro_graduate' ? (
                    <span className="pricing-badge pricing-badge-light">Lower price</span>
                  ) : null}
                  <h3>{planName(plan)}</h3>
                  <p className="pricing-card-intro">{planIntro(plan)}</p>
                  <p className="pricing-card-price">
                    <span>{plan.price.amount === 0 ? '₦0' : money(plan.price.amount)}</span>
                    <small>
                      {plan.price.amount === 0
                        ? 'free forever'
                        : plan.interval === 'year'
                          ? '/ year'
                          : '/ month'}
                    </small>
                  </p>
                  {plan.monthlyEquivalent && plan.interval === 'year' ? (
                    <p className="pricing-card-note">
                      About {money(Math.round(plan.monthlyEquivalent))} each month
                    </p>
                  ) : null}
                  {plan.founding &&
                  plan.standardAmount &&
                  plan.standardAmount > plan.price.amount ? (
                    <p className="pricing-card-note">
                      First price for the first 500 people who pay. It stays the same for 12 months.
                      Later price: {money(plan.standardAmount)}.
                    </p>
                  ) : null}
                  <ul className="pricing-card-list">
                    {(PLAN_POINTS[plan.id] ?? []).map((point) => (
                      <li key={point}>
                        <Check size={15} aria-hidden="true" /> {point}
                      </li>
                    ))}
                  </ul>
                  <a className="btn pricing-card-cta" href={action.href}>
                    {action.label} <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </article>
              )
            })}
          </div>
          {!plans ? <p role="status">Loading prices...</p> : null}
          <p className="pricing-under-note">
            Prices are in naira. Payments are not open yet. The buttons on this page do not take
            money.
          </p>
        </section>

        <section aria-labelledby="choose-heading">
          <div className="pricing-section-head">
            <div>
              <p className="eyebrow">Help me choose</p>
              <h2 id="choose-heading">Which plan fits you?</h2>
            </div>
          </div>
          <div className="pricing-choice-grid">
            <article>
              <h3>Stay on Free</h3>
              <p>Choose Free if you only want to search for jobs and apply.</p>
            </article>
            <article>
              <h3>Try Pro</h3>
              <p>Try Pro if you want help to check your CV and prepare each application.</p>
            </article>
            <article>
              <h3>Choose Yearly</h3>
              <p>Choose Yearly if your job search may take many months.</p>
            </article>
            <article>
              <h3>Check the graduate price</h3>
              <p>
                Check below if you are in final year, finished school not long ago, or are serving.
              </p>
            </article>
          </div>
        </section>

        <section id="compare" aria-labelledby="compare-heading">
          <div className="pricing-section-head">
            <div>
              <p className="eyebrow">Compare</p>
              <h2 id="compare-heading">What you get</h2>
            </div>
            <p>The free trial has all Pro tools. Two parts have a limit.</p>
          </div>
          <div className="table-wrap pricing-table-wrap">
            <table className="table pricing-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Free</th>
                  <th scope="col">Free trial</th>
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
                    <td data-label="Free">
                      <IncludedMark />
                    </td>
                    <td data-label="Free trial">
                      <IncludedMark />
                    </td>
                    <td data-label="Pro">
                      <IncludedMark />
                    </td>
                  </tr>
                ))}
                {PRO_FEATURES.map((feature) => (
                  <tr key={feature.id}>
                    <th scope="row">
                      {feature.title}
                      <span>{feature.what}</span>
                    </th>
                    <td data-label="Free">
                      <span className="pricing-no">No</span>
                    </td>
                    <td data-label="Free trial">
                      {feature.id === 'cv_analysis' ? (
                        '1 CV check'
                      ) : feature.id === 'prepared_applications' || feature.id === 'cv_check' ? (
                        '3 jobs shared'
                      ) : (
                        <IncludedMark />
                      )}
                    </td>
                    <td data-label="Pro">
                      <IncludedMark />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pricing-under-note">
            The three job limit is shared. If you compare your CV with a new job, that job counts.
            If you then prepare an application for the same job, it does not count again.
          </p>
        </section>

        <section className="graduate-check" id="graduate-check" aria-labelledby="graduate-heading">
          <div className="pricing-two-col">
            <div>
              <p className="eyebrow">Graduate price</p>
              <h2 id="graduate-heading">Pro for ₦3,000 each month</h2>
              <p>This price is for people who meet all of these rules:</p>
              <ul className="pricing-rule-list">
                <li>
                  <Check size={16} aria-hidden="true" /> You are in final year, or you finished
                  school in the last 24 months.
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> Or you are serving now, or you finished
                  NYSC in the last 12 months.
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> You have less than two years of full time
                  paid work.
                </li>
              </ul>
              <p className="pricing-privacy-note">
                We do not ask for your age, BVN or NIN. Do not send those to FJ.
              </p>
            </div>

            <div className="pricing-form-card">
              {!access ? (
                <div className="pricing-signup-box">
                  <h3>First, create a free account</h3>
                  <p>Then come back to this page and answer four short questions.</p>
                  <a className="btn btn--primary" href="/auth/signup?returnTo=%2Fpricing">
                    Create a free account
                  </a>
                  <p>
                    Already have an account? <a href="/auth/login?returnTo=%2Fpricing">Sign in</a>
                  </p>
                </div>
              ) : (
                <form onSubmit={(event) => void submitGraduate(event)}>
                  <div className="form-grid">
                    <label className="field">
                      Choose the one that fits you
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
                        <option value="final_year">I am in final year</option>
                        <option value="recent_graduate">I finished school not long ago</option>
                        <option value="nysc_current">I am serving now</option>
                        <option value="nysc_recent">I finished NYSC not long ago</option>
                        <option value="worker">None of these</option>
                      </select>
                    </label>
                    <label className="field">
                      Full time paid work since school
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
                        <option value="under_1_year">Less than 1 year</option>
                        <option value="1_to_2_years">1 year to less than 2 years</option>
                        <option value="over_2_years">2 years or more</option>
                      </select>
                    </label>
                    {needsEducationMonth ? (
                      <label className="field">
                        Month you finished school, or will finish
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
                        Month you finished NYSC, or will finish
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
                      </label>
                    ) : null}
                  </div>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={graduateForm.declared}
                      onChange={(event) =>
                        setGraduateForm((current) => ({
                          ...current,
                          declared: event.target.checked,
                        }))
                      }
                    />{' '}
                    I confirm that these answers are true.
                  </label>
                  <button className="btn btn--primary" type="submit" disabled={graduateBusy}>
                    {graduateBusy ? 'Checking...' : 'Check my price'}
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
                      ? 'You can use the graduate price'
                      : graduateResult.result === 'review'
                        ? 'We need to check your answers'
                        : 'This price does not fit your answers'}
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
                      ? 'When payments open, your price will be ₦3,000 each month. You can start the free trial now.'
                      : graduateResult.result === 'review'
                        ? 'Do not send your BVN, NIN or identity card. We will say what we need before payments open.'
                        : 'Pro Monthly and Pro Yearly have the same tools.'}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="pricing-note-panel" aria-labelledby="limits-heading">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2 id="limits-heading">What FJ will not do</h2>
            <ul className="plain-list pricing-limit-list">
              {PRO_LIMITS.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </div>
        </section>

        {plans && !plans.billingEnabled ? (
          <section className="waitlist pricing-waitlist" id="payments-opening-soon">
            <div>
              <p className="eyebrow">Payments</p>
              <h2>Payments are not open yet</h2>
              <p>
                We are setting up card and bank transfer payments. We will not take money today.
                Leave your email and we will tell you when payments open.
              </p>
            </div>
            {waitlist === 'done' ? (
              <p role="status">Thank you. We will email you when payments open.</p>
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
                    placeholder="you@example.com"
                  />
                </label>
                <button className="btn btn--primary">Email me when payments open</button>
                {waitlist === 'error' ? (
                  <p className="banner banner--demo" role="status">
                    We could not save your email. Please try again.
                  </p>
                ) : null}
              </form>
            )}
          </section>
        ) : null}

        <section className="pricing-employer" aria-labelledby="employers-heading">
          <div>
            <h2 id="employers-heading">For employers</h2>
            <p>
              Employer accounts and direct job posting are paused. There is no employer plan to buy.
            </p>
          </div>
          <a className="btn" href="/employers">
            Read more
          </a>
        </section>

        <section id="questions" aria-labelledby="questions-heading">
          <div className="pricing-section-head">
            <div>
              <p className="eyebrow">Questions</p>
              <h2 id="questions-heading">Common questions</h2>
            </div>
          </div>
          <div className="pricing-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="pricing-safety-note">
          FJ is not an employer. Check each job and company yourself. Never pay anyone to get a job.
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
    </div>
  )
}
