# Bachs payments for FJ

This is the owner checklist for turning real Pro payments on. The code is in
place, but **FJ cannot charge anyone until the two live Bachs secrets below are
added and the site is deployed again**.

Never paste an API key, webhook secret, bank detail, BVN, NIN, identity
document, password, one-time code or reset link into chat, a screenshot, a
GitHub issue or source code.

## How FJ charges

Bachs currently supports one-time naira card and bank-transfer payments. Its
automatic subscription renewals are for USD cards, so FJ does not promise
naira auto-renewal.

- Pro Monthly: one payment buys one calendar month.
- Pro Yearly: one payment buys one calendar year.
- Pro for Graduates: one payment buys one calendar month.
- FJ does not charge the customer again unless the customer chooses to buy
  more time.
- Buying while paid time or the free trial is still running starts the new
  paid time after the time already available ends.
- Search, opening jobs, free Telegram alerts and applying on the employer's
  site stay free.

Prices are set on the server:

| Plan              | Founding price | Later price |
| ----------------- | -------------: | ----------: |
| Pro Monthly       |         ₦5,000 |     ₦10,000 |
| Pro Yearly        |        ₦40,000 |     ₦60,000 |
| Pro for Graduates |         ₦3,000 |      ₦3,000 |

The founding price is for the first 500 distinct people who buy Pro Monthly
or Pro Yearly. A checkout holds a place for 24 hours. The place is confirmed
only when Bachs confirms payment, and the price is then locked for 12 months
from that first founding payment. Buying the graduate plan does not use a
founding place.

## What the owner must do in Bachs

1. Sign in to Bachs and make sure the account is in **live** mode, not
   sandbox.
2. Check that there are no open account tasks.
3. Check that the support email on the Bachs account is an inbox you read.
   Customers and Bachs may use it for payment problems and disputes.
4. Confirm that NGN is held or settled in the way you want and that the
   Nigerian bank withdrawal destination is approved and belongs to the
   verified account holder or registered business.
5. Open **Developer Portal → API keys**.
6. Create a live secret key named `FJ production checkout`.
7. Give that key only:
   - `payments:write` (shown by Bachs as **Create & charge**)
   - `customers:write`
8. Do not give the checkout key `payouts:write`. FJ checkout does not need it.
9. Open **Developer Portal → Webhooks** and create a live destination for:

   `https://fj-find-jobs.pages.dev/api/billing/webhook`

10. Subscribe that destination to:
    - `collection.succeeded`
    - `collection.failed`
    - `collection.underpaid`
    - `checkout.completed`
    - `checkout.expired`
    - `refund.created`
    - `refund.paid`
    - `refund.failed`
    - `dispute.created`
    - `dispute.updated`
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `invoice.paid`
    - `invoice.payment_failed`

Bachs sandbox keys, products, customers and webhooks do not carry over to
live mode. FJ uses server-priced fixed-amount checkout, so no Bachs product ID
is needed for this launch flow.

## Where the secrets go

Add them only as encrypted GitHub Actions secrets for this repository:

https://github.com/techoracle123/findjobs/settings/secrets/actions

| GitHub secret name     | Value                                            |
| ---------------------- | ------------------------------------------------ |
| `BACHS_SECRET_KEY`     | The live Bachs secret key. It starts `sk_live_`. |
| `BACHS_WEBHOOK_SECRET` | The signing secret for the live webhook above.   |

Then run the deployment again. Deployment opens production checkout only
when the key starts with `sk_live_` and the webhook secret is also present.
A sandbox key, a missing secret or a partial setup keeps checkout off.

## Checks before announcing payments

Do not announce payments from the presence of a buy button alone. First:

1. Confirm the latest deployment says **Bachs live payments configured**.
2. Open `/api/billing/plans` and confirm `billingEnabled` is `true` and the
   provider is `bachs`.
3. Use your own FJ account and make one small real purchase.
4. Confirm the payment is in Bachs.
5. Confirm the webhook destination shows a successful delivery.
6. Confirm Pro is on in the same FJ account and the paid end date is correct.
7. Confirm the money is visible in the Bachs balance and the withdrawal route
   is usable.
8. Test the support route you will use if a customer pays and Pro does not
   turn on.

If the Bachs balance is held in USD or another currency when you expected
NGN, fix the Bachs balance/settlement setting before announcing. Do not ask a
customer to test this for you.

## What happens if something goes wrong

- The browser returning from Bachs never turns Pro on by itself.
- FJ turns Pro on only after a signed Bachs confirmation matches the saved
  FJ checkout, user, plan, exact amount and currency.
- The plan page also checks recent checkouts with Bachs. This covers a delayed
  or missed webhook.
- Duplicate Bachs events for one charge do not add the same paid time twice.
- A first failed card attempt does not close the checkout.
- A bank transfer can still complete after a checkout is shown expired; FJ
  keeps the checkout record so that payment can be matched.
- Refunds are made by the owner in Bachs. FJ does not give customers a
  self-service refund button.
- The customer wording is: if a confirmed payment does not turn Pro on, FJ
  fixes it or refunds it; a duplicate payment for the same time can be
  refunded; after paid time starts, it normally runs to its end date and then
  stops.
- Employer posting stays paused. Affiliate payouts stay behind the existing
  14-day hold and the global payout kill switch.

## Support gap to close

FJ has a Contact page and Telegram route, but it does not currently publish a
support email. Before taking payments, either publish a monitored support
email or make sure the Contact route and the support email saved in Bachs are
checked every day. Payment and dispute messages can have deadlines.
