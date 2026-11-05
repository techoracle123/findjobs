import { useEffect, useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'
import type { PlanDefinition, Subscription } from '../lib/api'
import {
  cancelSubscription,
  describeBillingError,
  openBillingPortal,
  reconcileBilling,
  startCheckout,
  startProTrial,
} from '../lib/api'
import type { GraduateEligibilityState, ProTrialState } from '../shared/types'
import { FREE_FEATURES, PRO_FEATURES, PRO_LIMITS } from '../lib/pro-features'
import { FREE_ACCESS_MESSAGE, PRO_FREE_FOR_ALL } from '../shared/access'

interface PlanPanelProps {
  signedIn: boolean
  entitlements: string[]
  subscription: Subscription | null
  plans: PlanDefinition[]
  proTrial: ProTrialState
  graduateEligibility: GraduateEligibilityState | null
  billingEnabled: boolean
  billingProvider?: string
  onOpenPricing: () => void
  onRequireSignIn: () => void
  onRefresh: () => Promise<void> | void
}

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'trial', 'cancelling'])
const PRO_PLANS = new Set(['pro', 'pro_graduate', 'pro_annual'])

function fmtDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function price(plan: PlanDefinition): string {
  if (plan.price.amount === 0) return 'Free'
  const symbol = plan.price.currency === 'NGN' ? '₦' : `${plan.price.currency} `
  const suffix = plan.interval === 'year' ? ' / year' : ' / month'
  return `${symbol}${plan.price.amount.toLocaleString('en-NG')}${suffix}`
}

function subscriptionIsPro(subscription: Subscription | null): boolean {
  return Boolean(
    subscription &&
    PRO_PLANS.has(subscription.plan) &&
    ACTIVE_STATUSES.has(subscription.status) &&
    (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > Date.now()),
  )
}

function paidPlanName(plan: PlanDefinition): string {
  if (plan.id === 'pro') return 'Pro Monthly'
  if (plan.id === 'pro_annual') return 'Pro Yearly'
  if (plan.id === 'pro_graduate') return 'Pro for Graduates'
  return plan.displayLabel ?? plan.label
}

export function PlanPanel({
  signedIn,
  entitlements,
  subscription,
  plans,
  proTrial,
  graduateEligibility,
  billingEnabled,
  billingProvider,
  onOpenPricing,
  onRequireSignIn,
  onRefresh,
}: PlanPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [billingReturn] = useState(() => {
    if (typeof window === 'undefined') return null
    // Bachs adds checkout_id to the success URL. Tolerate a second question
    // mark if a provider ever appends it without merging the query string.
    const params = new URLSearchParams(
      window.location.search.replace(/^\?/, '').replace(/\?/g, '&'),
    )
    return params.get('billing') ?? (params.has('checkout_id') ? 'checking' : null)
  })
  const [billingChecks, setBillingChecks] = useState(0)
  const proActive = subscriptionIsPro(subscription)
  const trialActive = proTrial.status === 'active'
  const unlocked = proActive || trialActive
  const currentPlan = proActive ? 'Pro' : trialActive ? 'Pro free trial' : 'Free'
  const autoRenews = Boolean(
    billingProvider &&
    subscription?.provider === billingProvider &&
    subscription.providerSubscriptionId?.startsWith('sub_'),
  )
  const hasFeature = (feature: string) => unlocked || entitlements.includes(feature)

  useEffect(() => {
    if (billingReturn !== 'checking' || !signedIn) return
    if (proActive) {
      setNotice('Payment confirmed. Pro is on.')
      return
    }
    if (billingChecks >= 15) {
      setNotice(
        'We have not received payment confirmation yet. If you paid by bank transfer, wait a few minutes and use Check payment below. Do not pay again yet.',
      )
      return
    }
    setNotice(
      'We are checking your payment. Pro will turn on here when the payment service confirms it.',
    )
    const timer = window.setTimeout(
      () => {
        void (async () => {
          try {
            await reconcileBilling()
            await onRefresh()
          } catch {
            // The next scheduled check or the manual button can try again.
          } finally {
            setBillingChecks((count) => count + 1)
          }
        })()
      },
      billingChecks === 0 ? 800 : 4000,
    )
    return () => window.clearTimeout(timer)
  }, [billingChecks, billingReturn, onRefresh, proActive, signedIn])

  const startTrial = async () => {
    setBusy('trial')
    setNotice('')
    try {
      const result = await startProTrial()
      await onRefresh()
      setNotice(
        result.paid
          ? 'Pro is already active on your account.'
          : result.trial.status === 'active'
            ? `Your free 3-day Pro trial is active until ${fmtDate(result.trial.endsAt)}. No card was taken.`
            : 'Your one free 3-day Pro trial has already been used.',
      )
    } catch {
      setNotice('The trial could not start. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const checkPayment = async () => {
    if (!signedIn) {
      onRequireSignIn()
      return
    }
    setBusy('check')
    setNotice('Checking your recent payment...')
    try {
      const result = await reconcileBilling()
      await onRefresh()
      if (result.applied || subscriptionIsPro(result.subscription)) {
        setNotice('Payment confirmed. Pro is on.')
      } else if (result.checked === 0) {
        setNotice(
          'FJ has no recent payment page to check for this account. If no payment page opened and your bank took no money, choose a plan again. If your bank took money, use Contact us before paying again.',
        )
      } else if ((result.failedChecks ?? 0) > 0) {
        setNotice(
          'FJ could not check the payment service just now. Wait a short time and use Check payment again. Do not pay again yet.',
        )
      } else {
        setNotice(
          'No confirmed payment has arrived yet. Bank transfers can take a few minutes. Wait, then use Check payment again. Do not pay again yet.',
        )
      }
    } catch (error) {
      const info = describeBillingError(error)
      setNotice(info.message)
      if (info.action === 'sign_in') onRequireSignIn()
    } finally {
      setBusy(null)
    }
  }

  const subscribe = async (planId: string) => {
    if (!signedIn) {
      onRequireSignIn()
      return
    }
    if (!billingEnabled) {
      setNotice('Payments are not open yet. We cannot charge you today.')
      return
    }
    setBusy(planId)
    setNotice('')
    try {
      if (proActive && autoRenews) {
        const { session } = await openBillingPortal()
        if (session.url.includes('billing=manage')) setNotice('Manage your plan below.')
        else window.open(session.url, '_blank', 'noopener')
      } else {
        const { session } = await startCheckout(planId)
        window.location.href = session.url
      }
    } catch (error) {
      const info = describeBillingError(error)
      setNotice(info.message)
      if (info.action === 'sign_in') onRequireSignIn()
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    setBusy('cancel')
    setNotice('')
    try {
      await cancelSubscription()
      await onRefresh()
      setNotice('Your plan will end at the close of the period you have already paid for.')
    } catch (error) {
      const info = describeBillingError(error)
      setNotice(info.message)
      if (info.action === 'sign_in') onRequireSignIn()
    } finally {
      setBusy(null)
    }
  }

  const cvRemaining = Math.max(0, proTrial.limits.cvAnalyses - proTrial.cvAnalysesUsed)
  const packsRemaining = Math.max(
    0,
    proTrial.limits.applicationPacks - proTrial.applicationPacksUsed,
  )
  const planOrder = ['free', 'pro', 'pro_annual', 'pro_graduate']
  const shownPlans = plans
    .filter((plan) => (plan.audience ?? 'seeker') === 'seeker')
    .sort((a, b) => planOrder.indexOf(a.id) - planOrder.indexOf(b.id))

  if (PRO_FREE_FOR_ALL) {
    return (
      <section className="panel-page plan-panel" aria-label="Free for now">
        <header className="panel-head">
          <div>
            <p className="eyebrow">Your FJ access</p>
            <h2>Free for now</h2>
            <p className="muted">{FREE_ACCESS_MESSAGE}</p>
          </div>
          <div className="plan-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={signedIn ? onOpenPricing : onRequireSignIn}
            >
              {signedIn ? 'See what is included' : 'Create a free account'}
            </button>
          </div>
        </header>
        <div className="billing-box">
          <h3>Payments are paused</h3>
          <p className="muted">
            You cannot buy or renew a plan, and nothing on FJ asks for card details. Existing paid
            plans and payment records are not deleted. You can use the tools below now, within the
            rules that keep FJ safe and fair for everyone.
          </p>
        </div>
        <div className="plan-feature-grid">
          <article className="plan-column">
            <p className="eyebrow">Included now</p>
            <h3>Everything on FJ</h3>
            {[...FREE_FEATURES, ...PRO_FEATURES].map((feature) => (
              <div className="plan-feature" key={feature.id}>
                <strong>{feature.title}</strong>
                <p>{feature.what}</p>
                <span>{feature.why}</span>
              </div>
            ))}
          </article>
          <article className="plan-column">
            <p className="eyebrow">Still important</p>
            <h3>What stays the same</h3>
            {PRO_LIMITS.map((limit) => (
              <p className="plan-limit" key={limit}>
                {limit}
              </p>
            ))}
            <p className="plan-limit">
              Saved CV text and account information stay private. Product ideas and trending
              searches are free to explore without a paid plan.
            </p>
          </article>
        </div>
      </section>
    )
  }

  return (
    <section className="panel-page plan-panel" aria-label="Your plan">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Your FJ plan</p>
          <h2>{currentPlan}</h2>
          <p className="muted">
            {proActive
              ? `Pro is active${subscription?.currentPeriodEnd ? ` until ${fmtDate(subscription.currentPeriodEnd)}` : ''}.`
              : trialActive
                ? `Your free trial runs until ${fmtDate(proTrial.endsAt)}. It will stop on its own. We did not take card details. You can buy Pro below now, and the paid time will start after the trial.`
                : 'You can find jobs and apply for free. You can buy Pro below now. The 3-day trial is optional.'}
          </p>
        </div>
        <div className="plan-actions">
          <button className="btn btn-primary" type="button" onClick={onOpenPricing}>
            See prices
          </button>
        </div>
      </header>

      {!signedIn ? (
        <div className="billing-box">
          <h3>Sign in to manage your plan</h3>
          <p className="muted">
            Your profile, saved jobs, alerts, free trial and any future Pro plan belong to your free
            FJ account.
          </p>
        </div>
      ) : null}

      {signedIn && !proActive && proTrial.status === 'not_started' ? (
        <div className="trial-box">
          <div>
            <p className="eyebrow">Free trial</p>
            <h3>3-day Pro free trial</h3>
            <p>
              Use all Pro tools for 3 days. Check one CV in full. Use Match Intelligence and
              application help for three listings. We do not ask for card details. There is no
              charge when the trial ends. This trial is optional. You do not need it before you pay.{' '}
              <a href="#fj-plan-prices">See the paid plans below</a>.
            </p>
          </div>
          <button
            className="btn btn-primary btn-large"
            type="button"
            disabled={busy !== null}
            onClick={() => void startTrial()}
          >
            {busy === 'trial' ? 'Starting…' : 'Start my 3-day free trial'}
          </button>
        </div>
      ) : null}

      {signedIn && trialActive ? (
        <div className="trial-box" role="status">
          <div>
            <p className="eyebrow">Trial active</p>
            <h3>What is left in your trial</h3>
            <p>
              You have {cvRemaining} CV check and {packsRemaining} job
              {packsRemaining === 1 ? '' : 's'} left. Reports you create stay in your account after
              the trial ends. You can buy Pro below now. Paid time starts after this trial ends.
            </p>
          </div>
          <span className="status-pill">Ends {fmtDate(proTrial.endsAt)}</span>
        </div>
      ) : null}

      {signedIn && !proActive && !trialActive && proTrial.status !== 'not_started' ? (
        <div className="billing-box" role="status">
          <h3>Your free trial has ended</h3>
          <p className="muted">
            You can still search, save jobs, get basic alerts and apply for free. Reports you
            created stay in your account.{' '}
            {billingEnabled
              ? 'You can buy Pro below by card or bank transfer.'
              : 'Payments are not open yet.'}
          </p>
        </div>
      ) : null}

      {graduateEligibility ? (
        <div className="billing-box">
          <h3>Pro for Graduates</h3>
          <p className="muted">
            {graduateEligibility.result === 'eligible'
              ? `You can use the ₦3,000 monthly graduate price${billingEnabled ? ' below' : ' when payments open'}. It has the same Pro tools.`
              : graduateEligibility.result === 'review'
                ? `We need to check your answers before the graduate price can be used. ${billingEnabled ? 'You can buy Pro Monthly or Pro Yearly below now.' : 'You can still use Free.'} Regular Pro has the same tools.`
                : `This price does not fit your answers. ${billingEnabled ? 'You can buy Pro Monthly or Pro Yearly below now.' : 'Regular Pro has the same tools.'}`}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="billing-box" id="fj-plan-prices">
        <div className="inline-head">
          <h3>{billingEnabled ? 'Buy Pro or add time' : 'Prices'}</h3>
          {!billingEnabled ? <span className="status-pill">Payments not open yet</span> : null}
        </div>
        {!billingEnabled ? (
          <p className="muted">
            <CreditCard size={14} /> Payments are not open yet. Nothing on this page can charge you.
            Card and bank transfer payments will come later.
          </p>
        ) : (
          <p className="muted">
            <CreditCard size={14} /> You do not need to start the free trial before you pay. Pay by
            card or bank transfer. Each payment buys one month or one year. FJ will not charge you
            again unless you choose to pay.
          </p>
        )}
        {shownPlans.length === 0 ? (
          <p className="muted">Prices are loading. If they do not appear, reload this page.</p>
        ) : null}
        <div className="plan-price-grid">
          {shownPlans.map((plan) => {
            const paid = plan.price.amount > 0
            const isCurrent = proActive
              ? subscription?.plan === plan.id
              : !trialActive && plan.id === 'free'
            const graduateLocked =
              plan.id === 'pro_graduate' && graduateEligibility?.result !== 'eligible'
            return (
              <article className="plan-price-card" key={plan.id}>
                <p className="eyebrow">{plan.displayLabel ?? plan.label}</p>
                <p className="plan-price">{price(plan)}</p>
                {plan.founding && plan.standardAmount && plan.standardAmount > plan.price.amount ? (
                  <p className="muted">
                    First price. Later price: ₦{plan.standardAmount.toLocaleString()}.
                  </p>
                ) : null}
                {plan.id === 'pro_graduate' ? (
                  <p className="muted">Same Pro tools for people who qualify.</p>
                ) : null}
                {isCurrent ? <span className="status-pill status-open">Current</span> : null}
                {paid ? (
                  <button
                    className="btn btn--sm"
                    type="button"
                    disabled={busy !== null || !billingEnabled || graduateLocked}
                    onClick={() => void subscribe(plan.id)}
                  >
                    {proActive && autoRenews ? (
                      <>
                        <ExternalLink size={13} /> Manage billing
                      </>
                    ) : !billingEnabled ? (
                      'Payments not open yet'
                    ) : graduateLocked ? (
                      'Check graduate price first'
                    ) : busy === plan.id ? (
                      'Opening…'
                    ) : proActive ? (
                      `Add ${paidPlanName(plan)} time`
                    ) : (
                      `Buy ${paidPlanName(plan)}`
                    )}
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
        {signedIn && billingEnabled ? (
          <div className="plan-actions">
            <button
              className="btn btn--sm"
              type="button"
              disabled={busy !== null}
              onClick={() => void checkPayment()}
            >
              {busy === 'check' ? 'Checking…' : 'Check payment'}
            </button>
            <span className="muted">
              Use this if you paid and Pro is not on yet. Do not pay again before checking.
            </span>
          </div>
        ) : null}
        {proActive && billingEnabled && autoRenews && !subscription?.cancelAtPeriodEnd ? (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            disabled={busy !== null}
            onClick={() => void cancel()}
          >
            Cancel at period end
          </button>
        ) : null}
        {subscription?.cancelAtPeriodEnd ? (
          <p className="muted">
            This plan is set to end on {fmtDate(subscription.currentPeriodEnd)} and will not renew.
          </p>
        ) : null}
      </div>

      <div className="plan-feature-grid">
        <article className="plan-column">
          <p className="eyebrow">Always free</p>
          <h3>Find and apply</h3>
          {FREE_FEATURES.map((feature) => (
            <div className="plan-feature" key={feature.id}>
              <strong>{feature.title}</strong>
              <span className="status-pill status-open">Included</span>
              <p>{feature.what}</p>
              <small>{feature.why}</small>
            </div>
          ))}
        </article>

        <article className="plan-column plan-column-pro">
          <p className="eyebrow">Pro</p>
          <h3>Check and prepare</h3>
          {PRO_FEATURES.map((feature) => (
            <div className="plan-feature" key={feature.id}>
              <strong>{feature.title}</strong>
              <span className={`status-pill ${hasFeature(feature.id) ? 'status-open' : ''}`}>
                {hasFeature(feature.id) ? 'Included' : 'Pro'}
              </span>
              <p>{feature.what}</p>
              <small>{feature.why}</small>
            </div>
          ))}
        </article>
      </div>

      <div className="billing-box">
        <h3>What FJ will not do</h3>
        <ul className="plain-list">
          {PRO_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
