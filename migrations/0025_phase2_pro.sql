-- Phase 2 Pro: a one-time 3-day trial, graduate-price eligibility, a saved
-- master CV (readable text only, saved with the owner's permission), richer
-- alerts and a fuller application pipeline. Payments remain a later phase.

CREATE TABLE IF NOT EXISTS pro_trials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pro_trial_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_pro_trial_usage_user_kind
  ON pro_trial_usage (user_id, kind);

CREATE TABLE IF NOT EXISTS graduate_eligibility (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  education_month TEXT,
  nysc_month TEXT,
  full_time_experience TEXT NOT NULL,
  declared INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  flags TEXT NOT NULL DEFAULT '[]',
  eligible_until TEXT,
  proof_status TEXT NOT NULL DEFAULT 'not_requested',
  checked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The browser reads the original CV file. FJ stores only readable text and
-- the resulting report after the owner expressly asks for detailed analysis.
CREATE TABLE IF NOT EXISTS master_cvs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  cv_text TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  report TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE alerts ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';

ALTER TABLE saved_jobs ADD COLUMN stage TEXT NOT NULL DEFAULT 'saved';
ALTER TABLE saved_jobs ADD COLUMN follow_up_at TEXT;

UPDATE saved_jobs SET stage = 'applied' WHERE status = 'applied';
