-- Trust and safety: user reports and moderation decisions. A report is an
-- allegation, never proof; the listing is hidden pending human review.
CREATE TABLE IF NOT EXISTS job_reports (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  reason        TEXT NOT NULL,
  comment       TEXT,
  reporter_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_job_reports_job ON job_reports(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_reports_state ON job_reports(state);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
