-- Job source ingestion.
--
-- `jobs` remains the canonical table the application reads. The tables below
-- track where each posting came from, what the source said verbatim, and how
-- each ingestion run went, so a broken source is visible rather than silent.

CREATE TABLE IF NOT EXISTS sources (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  adapter      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  homepage     TEXT,
  last_run_at  TEXT,
  last_status  TEXT,
  last_error   TEXT,
  config       TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per posting seen at a source. `content_hash` changes when the
-- source updates the posting, which is what triggers a refresh of the
-- canonical row.
CREATE TABLE IF NOT EXISTS source_postings (
  source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,
  job_id        TEXT,
  payload       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expired_at    TEXT,
  PRIMARY KEY (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_source_postings_job ON source_postings (job_id);
CREATE INDEX IF NOT EXISTS idx_source_postings_seen ON source_postings (source_id, last_seen_at);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running',
  fetched     INTEGER NOT NULL DEFAULT 0,
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  expired     INTEGER NOT NULL DEFAULT 0,
  skipped     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON ingestion_runs (source_id, started_at);

-- Full-text search over postings. Maintained explicitly by the ingestion
-- path rather than by triggers, so the behaviour is easy to reason about.
CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
  job_id UNINDEXED,
  title,
  company,
  description,
  skills,
  tokenize = 'unicode61'
);
