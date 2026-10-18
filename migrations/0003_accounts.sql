-- Account schema.
--
-- Identity is provided by Cloudflare Access, so there is no password or
-- session table here: the Access JWT is the session. This table mirrors the
-- identity so the rest of the system has a stable local key and a place to
-- hang account-scoped data.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skills               TEXT NOT NULL DEFAULT '[]',
  target_role_families TEXT NOT NULL DEFAULT '[]',
  target_seniority     TEXT NOT NULL DEFAULT '[]',
  preferred_work_modes TEXT NOT NULL DEFAULT '[]',
  work_country         TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_jobs (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'saved',
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  query      TEXT,
  channels   TEXT NOT NULL DEFAULT '[]',
  enabled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts (user_id);

-- Billing state mirrored from the payment provider. Entitlements are always
-- derived server-side from this; the client is never trusted.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,
  provider_customer_id   TEXT,
  provider_subscription_id TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'active',
  current_period_end     TEXT,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature    TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  PRIMARY KEY (user_id, feature)
);

-- Records of consent for processing that the service cannot function without.
CREATE TABLE IF NOT EXISTS consents (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  granted    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consents_user_kind ON consents (user_id, kind);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  metadata   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, created_at);
