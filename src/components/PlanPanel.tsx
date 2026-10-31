import { useState } from 'react'
import { CreditCard, ExternalLink } from 'lucide-react'
import type { PlanDefinition, Subscription } from '../lib/api'
import { cancelSubscription, openBillingPortal, startCheckout, startProTrial } from '../lib/api'
import type { GraduateEligibilityState, ProTrialState } from '../shared/types'
import { FREE_FEATURES, PRO_FEATURES, PRO_LIMITS } from '../lib/pro-features'

interface PlanPanelProps {
  signedIn: boolean
  entitlements: string[]
  subscription: Subscription | null
  plans: PlanDefinition[]
  proTrial: ProTrialState
  graduateEligibility: GraduateEligibilityState | null
  billingEnabled: boolean
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

export function PlanPanel({
  signedIn,
  entitlements,
  subscription,
  plans,
  proTrial,
  graduateEligibility,
  billingEnabled,
  onOpenPricing,
  onRequireSignIn,
  onRefresh,
}: PlanPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const proActive = Boolean(
    subscription &&
    PRO_PLANS.has(subscription.plan) &&
    ACTIVE_STATUSES.has(subscription.status) &&
    (!subscription.currentPeriodEnd || Date.parse(subscription.currentPeriodEnd) > Date.now()),
  )
  const trialActive = proTrial.status === 'active'
  const unlocked = proActive || trialActive
  const currentPlan = proActive ? 'Pro' : trialActive ? 'Pro free trial' : 'Free'
  const hasFeature = (feature: string) => unlocked || entitlements.includes(feature)

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
      setNotice('The trial could not be started just now. Please try again.')
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
      setNotice('Payments open in the next stage. Nothing can charge you today.')
      return
    }
    setBusy(planId)
    setNotice('')
    try {
      if (proActive) {
        const { session } = await openBillingPortal()
        if (session.url.includes('billing=manage')) setNotice('Manage your plan below.')
        else window.open(session.url, '_blank', 'noopener')
      } else {
        const { session } = await startCheckout(planId)
        window.location.href = session.url
      }
    } catch {
      setNotice('That billing action could not be completed just now. Please try again.')
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
    } catch {
      setNotice('Your plan could not be cancelled just now. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const cvRemaining = Math.max(0, proTrial.limits.cvAnalyses - proTrial.cvAnalysesUsed)
  const packsRemaining = Math.max(
    0,
    proTrial.limits.applicationPacks - proTrial.applicationPacksUsed,
  )
  const shownPlans = plans.filter((plan) => (plan.audience ?? 'seeker') === 'seeker')

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
                ? `Your free trial runs until ${fmtDate(proTrial.endsAt)}. It will stop by itself — no card was taken.`
                : 'Everything you need to find jobs and apply on employer sites is free. Pro adds the tools below.'}
          </p>
        </div>
        <div className="plan-actions">
          <button className="btn btn-primary" type="button" onClick={onOpenPricing}>
            See prices and full comparison
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
            <p className="eyebrow">Try the work before you decide</p>
            <h3>3-day Pro free trial</h3>
            <p>
              Use every Pro tool for 72 hours. The trial includes one full CV analysis and three
              complete application packs. No card, no automatic charge and no change to free
              employer-site applications.
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
              {cvRemaining} full CV analysis and {packsRemaining} application pack
              {packsRemaining === 1 ? '' : 's'} remaining. Generated CV reports and application
              packs stay in your account after the trial ends.
            </p>
          </div>
          <span className="status-pill">Ends {fmtDate(proTrial.endsAt)}</span>
        </div>
      ) : null}

      {signedIn && !proActive && !trialActive && proTrial.status !== 'not_started' ? (
        <div className="billing-box" role="status">
          <h3>Your free trial has ended</h3>
          <p className="muted">
            Free search, saved jobs, basic alerts and employer-site applications continue as before.
            Your generated CV report and application packs remain available. Card and bank-transfer
            payments are opening in the next stage.
          </p>
        </div>
      ) : null}

      {graduateEligibility ? (
        <div className="billing-box">
          <h3>Pro for Graduates</h3>
          <p className="muted">
            {graduateEligibility.result === 'eligible'
              ? 'You qualify for the ₦3,000 monthly graduate price when payments open. It includes the same Pro tools.'
              : graduateEligibility.result === 'review'
                ? 'Your graduate-price check needs review because one or more answers need clarification. Regular Pro and all Free features remain available.'
                : 'The graduate price does not apply from your answers. Regular Pro has the same tools.'}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="billing-box">
        <div className="inline-head">
          <h3>Prices</h3>
          {!billingEnabled ? <span className="status-pill">Payments opening soon</span> : null}
        </div>
        {!billingEnabled ? (
          <p className="muted">
            <CreditCard size={14} /> No payment provider is active today, so nothing here can charge
            you. Card and bank transfer arrive in the next stage.
          </p>
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
                    Founding price. Later standard price: ₦{plan.standardAmount.toLocaleString()}.
                  </p>
                ) : null}
                {plan.id === 'pro_graduate' ? (
                  <p className="muted">
                    Same Pro tools for eligible final-year students, recent graduates and corps
                    members.
                  </p>
                ) : null}
                {isCurrent ? <span className="status-pill status-open">Current</span> : null}
                {paid ? (
                  <button
                    className="btn btn--sm"
                    type="button"
                    disabled={busy !== null || !billingEnabled || graduateLocked}
                    onClick={() => void subscribe(plan.id)}
                  >
                    {proActive ? (
                      <>
                        <ExternalLink size={13} /> Manage billing
                      </>
                    ) : !billingEnabled ? (
                      'Payments opening soon'
                    ) : graduateLocked ? (
                      'Check graduate eligibility first'
                    ) : busy === plan.id ? (
                      'Opening…'
                    ) : (
                      `Choose ${plan.displayLabel ?? plan.label}`
                    )}
                  </button>
                ) : null}
              </article>
            )
          })}
        </div>
        {proActive && billingEnabled && !subscription?.cancelAtPeriodEnd ? (
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
          <h3>Choose better and apply stronger</h3>
          {PRO_FEATURES.map((feature) => (
            <div className="plan-feature" key={feature.id}>
              <strong>{feature.title}</strong>
              <span className={`status-pill ${hasFeature(feature.id) ? 'status-open' : ''}`}>
                {hasFeature(feature.id) ? 'Unlocked' : 'Pro'}
              </span>
              <p>{feature.what}</p>
              <small>{feature.why}</small>
            </div>
          ))}
        </article>
      </div>

      <div className="billing-box">
        <h3>Plain limits</h3>
        <ul className="plain-list">
          {PRO_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
