-- Application confirmations are user-reported, not employer-verified. Keeping
-- history separate means removing a bookmark does not erase monthly progress.
CREATE TABLE IF NOT EXISTS application_history (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  applied_at TEXT,
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_application_history_month ON application_history(user_id, applied_at);
-- Old records have no trustworthy application date. Do not invent one.
INSERT OR IGNORE INTO application_history(user_id,job_id,applied_at)
SELECT user_id,job_id,NULL FROM saved_jobs WHERE status='applied';
