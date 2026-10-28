-- Billing event receipts and the AI budget.
--
-- A payment provider will send the same webhook again when it does not get
-- the answer it expects, so every billing event is recorded before it is
-- applied. The receipt is what makes a repeat of the same event a no-op
-- instead of a second grant.
CREATE TABLE IF NOT EXISTS billing_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_received ON billing_events (received_at);

-- The AI budget.
--
-- Every call to the Workers AI binding costs money, so the number of calls
-- is counted per account and for the deployment as a whole. The scope
-- "global" is the deployment-wide counter; every other scope is an account.
CREATE TABLE IF NOT EXISTS ai_usage (
  scope      TEXT NOT NULL,
  day        TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, day)
);
