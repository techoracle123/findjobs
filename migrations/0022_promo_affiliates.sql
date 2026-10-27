-- Prompt 5 (FJ2026 promo) + Prompt 6 (affiliates).
-- Affiliate conversions carry a 14-day hold; payouts run only when the
-- global kill switch is off.

CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  percent_off INTEGER NOT NULL,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  code TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);

CREATE TABLE IF NOT EXISTS affiliates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  payout_account TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  id TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held', -- held | approved | paid | cancelled
  release_at INTEGER NOT NULL,         -- 14-day hold
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_affconv_status ON affiliate_conversions(status, release_at);

-- One row, one flag. Payouts refuse to run while this is 1.
CREATE TABLE IF NOT EXISTS payout_settings (
  id TEXT PRIMARY KEY CHECK (id = 'global'),
  kill_switch INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO payout_settings (id, kill_switch, updated_at) VALUES ('global', 1, 0);
