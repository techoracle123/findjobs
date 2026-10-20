import type { AppConfig } from '../config'
import { FakeProvider } from './fake'
import { FlutterwaveProvider } from './flutterwave'
import { PaystackProvider } from './paystack'
import { StripeProvider } from './stripe'
import { planPrices } from './pricing'
import type { PaymentProvider } from './types'

/**
 * Chooses the payment provider.
 *
 * A real provider is only used when it is fully configured — a half
 * configured key must not silently take money and then fail to record the
 * subscription. When the chosen provider is not ready the fake provider is
 * used instead, which never charges anyone, and the readiness report says
 * what is missing.
 */
export function providerFor(config: AppConfig): PaymentProvider {
  const plans = planPrices(config)
  const billing = config.billing

  switch (billing.provider) {
    case 'paystack':
      if (billing.paystack.secretKey) {
        return new PaystackProvider(billing.paystack.secretKey, plans)
      }
      break
    case 'flutterwave':
      if (billing.flutterwave.secretKey && billing.flutterwave.webhookSecret) {
        return new FlutterwaveProvider(
          billing.flutterwave.secretKey,
          billing.flutterwave.webhookSecret,
          plans,
        )
      }
      break
    case 'stripe':
      if (billing.stripe.secretKey && billing.stripe.webhookSecret && billing.stripe.pricePro) {
        return new StripeProvider(billing.stripe.secretKey, billing.stripe.webhookSecret, plans)
      }
      break
    case 'fake':
      break
  }

  return new FakeProvider()
}

export function hasRealProvider(config: AppConfig): boolean {
  return providerFor(config).id !== 'fake'
}
