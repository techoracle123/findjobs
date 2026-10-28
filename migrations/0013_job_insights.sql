-- Cached translations are tied to exact source text. A short lease prevents duplicate AI calls.
CREATE TABLE job_translations (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  english_text TEXT,
  lease_owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);
-- Only the hashed cache key and advice are stored, never a CV or a raw profile.
CREATE TABLE job_advice_cache (
  cache_key TEXT PRIMARY KEY,
  tips TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_advice_created ON job_advice_cache(created_at);
-- Re-run source normalisation with the broader profession catalogue and cleaned descriptions.
UPDATE source_postings SET content_hash = 'refresh-general-professions-v1:' || content_hash
WHERE source_id IN (SELECT id FROM sources WHERE enabled = 1);
UPDATE sources SET last_run_at = NULL WHERE enabled = 1;

-- Cross-isolate FX cache: the provider updates daily, so visitors do not each fetch rates.
CREATE TABLE service_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);

-- The public Remotive licence restricts submissions to third-party job sites.
-- Keep the adapter for tests/operator-authorised use, but do not redistribute its jobs.
UPDATE sources SET enabled = 0, disabled_reason = 'Publisher redistribution permission required' WHERE id = 'remotive';
UPDATE jobs SET expired_at = datetime('now') WHERE source_id = 'remotive';
