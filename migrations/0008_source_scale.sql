-- Scaling the source registry, and tracking the life of a posting.
--
-- The registry moves from "a handful of hand-listed sources" to "a table of
-- many kinds of source": a named API, an applicant-tracking system, a
-- generic page carrying schema.org markup, or a feed. Each source carries
-- its own refresh tier, rate limit and verification policy, because a
-- large employer board and a small niche board should not be polled the
-- same way.

ALTER TABLE sources ADD COLUMN kind TEXT NOT NULL DEFAULT 'api';
ALTER TABLE sources ADD COLUMN platform TEXT;
ALTER TABLE sources ADD COLUMN listing_url TEXT;
ALTER TABLE sources ADD COLUMN verification TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE sources ADD COLUMN refresh_tier TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE sources ADD COLUMN rate_limit_per_hour INTEGER NOT NULL DEFAULT 60;
ALTER TABLE sources ADD COLUMN country TEXT;
ALTER TABLE sources ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sources ADD COLUMN disabled_reason TEXT;
ALTER TABLE sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources (kind);
CREATE INDEX IF NOT EXISTS idx_sources_platform ON sources (platform);
CREATE INDEX IF NOT EXISTS idx_sources_tier ON sources (refresh_tier, enabled);

-- The life of a posting: when it was first seen, when it was last confirmed
-- alive, whether it has closed, and why the source considers it verified.
ALTER TABLE jobs ADD COLUMN verification TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE jobs ADD COLUMN verification_reason TEXT;
ALTER TABLE jobs ADD COLUMN verified_at TEXT;
ALTER TABLE jobs ADD COLUMN job_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE jobs ADD COLUMN closed_at TEXT;
ALTER TABLE jobs ADD COLUMN closed_reason TEXT;
ALTER TABLE jobs ADD COLUMN first_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN last_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN apply_url TEXT;
ALTER TABLE jobs ADD COLUMN company_url TEXT;
ALTER TABLE jobs ADD COLUMN source_kind TEXT;
ALTER TABLE jobs ADD COLUMN source_platform TEXT;
ALTER TABLE jobs ADD COLUMN country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (job_status);
CREATE INDEX IF NOT EXISTS idx_jobs_verification ON jobs (verification);
CREATE INDEX IF NOT EXISTS idx_jobs_seen ON jobs (last_seen_at);

-- A log of everything that happened to a posting, so a closed role has a
-- history rather than just a flag.
CREATE TABLE IF NOT EXISTS job_events (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL,
  type       TEXT NOT NULL,
  detail     TEXT,
  source_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events (job_id, created_at);

-- Per-host politeness: one row per hostname, refreshed as the crawl runs.
CREATE TABLE IF NOT EXISTS host_policies (
  host            TEXT PRIMARY KEY,
  robots_fetched_at TEXT,
  robots_rules    TEXT NOT NULL DEFAULT '',
  crawl_delay_ms  INTEGER NOT NULL DEFAULT 1000,
  last_request_at TEXT,
  request_count   INTEGER NOT NULL DEFAULT 0
);

-- A rolling count of what each source produced, for the operator view.
CREATE TABLE IF NOT EXISTS source_daily_stats (
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  fetched    INTEGER NOT NULL DEFAULT 0,
  inserted   INTEGER NOT NULL DEFAULT 0,
  updated    INTEGER NOT NULL DEFAULT 0,
  expired    INTEGER NOT NULL DEFAULT 0,
  errors     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_id, day)
);
