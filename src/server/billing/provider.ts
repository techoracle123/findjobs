import type { AppConfig } from '../config'
import { FakeProvider } from './fake'
import { StripeProvider } from './stripe'
import type { PaymentProvider } from './types'

/**
 * Chooses the payment provider. A real provider is only used when it is
 * fully configured — a half-configured Stripe key must not silently take
 * money and then fail to record the subscription.
 */
export function providerFor(config: AppConfig): PaymentProvider {
  const { secretKey, webhookSecret, pricePro } = config.stripe
  if (secretKey && webhookSecret && pricePro) {
    return new StripeProvider(secretKey, webhookSecret)
  }
  return new FakeProvider()
}

export function hasRealProvider(config: AppConfig): boolean {
  return providerFor(config) instanceof StripeProvider
}
