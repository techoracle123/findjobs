-- Fast Apply is the only counted application mode. External applications on
-- the employer's own site stay free and unlimited for everyone.
ALTER TABLE jobs ADD COLUMN apply_mode TEXT NOT NULL DEFAULT 'external';

CREATE TABLE IF NOT EXISTS apply_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  anon_id    TEXT,
  job_id     TEXT NOT NULL,
  mode       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_apply_events_user ON apply_events(user_id, mode, created_at);
CREATE INDEX IF NOT EXISTS idx_apply_events_anon ON apply_events(anon_id, mode, created_at);

-- Daily counters for the free Fast Apply limit. The day window is
-- Africa/Lagos, so window_date is the Lagos calendar date.
CREATE TABLE IF NOT EXISTS apply_quotas (
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  window_date  TEXT NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_type, subject_id, window_date)
);
