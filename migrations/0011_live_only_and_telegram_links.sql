-- Permanently remove fictional postings, including references saved during preview.
DELETE FROM saved_jobs WHERE job_id IN (SELECT id FROM jobs WHERE is_demo = 1);
DELETE FROM jobs_fts WHERE job_id IN (SELECT id FROM jobs WHERE is_demo = 1);
DELETE FROM job_events WHERE job_id IN (SELECT id FROM jobs WHERE is_demo = 1);
DELETE FROM jobs WHERE is_demo = 1;

-- Opaque, single-use Telegram links fit Telegram's 64-character start payload limit.
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_links_expiry ON telegram_link_tokens(expires_at);
