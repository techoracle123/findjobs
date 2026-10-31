-- Phase 3 payments.
--
-- A checkout is recorded before Bachs is called, so the signed webhook can
-- be matched to the signed-in FJ user, the plan, and the exact naira amount
-- FJ asked Bachs to collect. The browser return page never grants Pro.

CREATE TABLE IF NOT EXISTS billing_checkout_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  provider TEXT NOT NULL,
  pricing_tier TEXT NOT NULL DEFAULT 'standard', -- founding | standard | graduate
  amount_kobo INTEGER NOT NULL,
  currency TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider_checkout_id TEXT UNIQUE,
  checkout_url TEXT,
  provider_customer_id TEXT,
  provider_charge_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'created', -- created | open | uncertain | paid | failed | expired | refunded | disputed
  period_start TEXT,
  period_end TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_user_status
  ON billing_checkout_attempts(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_reference
  ON billing_checkout_attempts(reference);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_checkout
  ON billing_checkout_attempts(provider_checkout_id);
CREATE INDEX IF NOT EXISTS idx_billing_attempts_charge
  ON billing_checkout_attempts(provider_charge_id);

-- The founding offer is for the first 500 people who buy Pro Monthly or
-- Pro Yearly at the founding price. A slot is reserved while checkout is in
-- progress and confirmed only after Bachs confirms payment. The confirmed
-- row also carries that person's 12-month price lock.
CREATE TABLE IF NOT EXISTS billing_founding_claims (
  slot_no INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'reserved', -- reserved | confirmed
  reserved_until TEXT,
  first_paid_at TEXT,
  lock_until TEXT,
  first_plan TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_billing_founding_status
  ON billing_founding_claims(status, reserved_until);

-- Bachs can deliver subscription events out of order. Keep the newest event
-- time applied for each provider subscription so an older retry cannot
-- overwrite newer billing state.
CREATE TABLE IF NOT EXISTS billing_subscription_state (
  provider TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  user_id TEXT,
  last_event_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_customer
  ON subscriptions(provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription
  ON subscriptions(provider_subscription_id);
