-- Columns that let a posting be traced back to the source it came from and
-- given an expiry, so postings that disappear upstream can be retired.

ALTER TABLE jobs ADD COLUMN source_id TEXT;
ALTER TABLE jobs ADD COLUMN external_id TEXT;
ALTER TABLE jobs ADD COLUMN content_hash TEXT;
ALTER TABLE jobs ADD COLUMN expired_at TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs (source_id, external_id);
CREATE INDEX IF NOT EXISTS idx_jobs_expired ON jobs (expired_at);
