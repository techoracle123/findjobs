import { describe, expect, it } from 'vitest'
import { ApiError, describeBillingError } from '../../src/lib/api'

function apiError(status: number, body: unknown): ApiError {
  return new ApiError(`request failed (${status})`, status, JSON.stringify(body))
}

describe('billing error wording', () => {
  it('tells a signed-out user to sign in again', () => {
    const info = describeBillingError(apiError(401, { error: 'unauthorized' }))
    expect(info.action).toBe('sign_in')
    expect(info.message).toContain('Sign in again')
  })

  it('keeps the graduate check separate from the other paid plans', () => {
    const info = describeBillingError(apiError(403, { error: 'graduate_eligibility_required' }))
    expect(info.action).toBe('graduate_check')
    expect(info.message).toContain('Pro Monthly and Pro Yearly do not need that check')
  })

  it('shows only the FJ support reference for a payment-account failure', () => {
    const info = describeBillingError(
      apiError(502, {
        error: 'payments_account_attention',
        failure: 'provider_account_attention',
        supportReference: 'att_12345678-abcd',
        detail: 'raw provider body that must not be shown',
      }),
    )
    expect(info.action).toBe('contact')
    expect(info.message).toContain('Payments need attention')
    expect(info.message).toContain('att_12345678-abcd')
    expect(info.message).not.toContain('raw provider body')
  })

  it('does not tell a user to pay again when checkout creation is uncertain', () => {
    const info = describeBillingError(
      apiError(502, {
        error: 'checkout_outcome_unknown',
        failure: 'outcome_unknown',
        supportReference: 'att_12345678-abcd',
      }),
    )
    expect(info.action).toBe('check_payment')
    expect(info.message).toContain('Do not pay again yet')
  })

  it('explains rate limits and network failures in plain words', () => {
    expect(describeBillingError(apiError(429, { error: 'rate_limited' }))).toMatchObject({
      action: 'retry_later',
    })
    expect(describeBillingError(new TypeError('failed to fetch'))).toMatchObject({
      code: 'network_error',
      action: 'retry_later',
    })
  })
})
