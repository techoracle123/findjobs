-- Schema for the Role Signal preview.
--
-- The preview stores canonical job postings only. Account-specific data
-- (profile, saved jobs, applications, alert preferences) lives in the
-- browser until server-side authentication exists.

CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  title             TEXT    NOT NULL,
  company           TEXT    NOT NULL,
  role_family       TEXT    NOT NULL,
  seniority         TEXT    NOT NULL,
  work_mode         TEXT    NOT NULL,
  location_country  TEXT    NOT NULL,
  location_label    TEXT    NOT NULL,
  salary_min        REAL,
  salary_max        REAL,
  salary_currency   TEXT,
  salary_period     TEXT    NOT NULL DEFAULT 'year',
  description       TEXT    NOT NULL DEFAULT '',
  required_skills   TEXT    NOT NULL DEFAULT '[]',
  useful_skills     TEXT    NOT NULL DEFAULT '[]',
  eligible_countries TEXT   NOT NULL DEFAULT '[]',
  sponsorship       TEXT    NOT NULL DEFAULT 'unknown',
  source_name       TEXT    NOT NULL,
  source_url        TEXT    NOT NULL,
  posted_days_ago   INTEGER NOT NULL DEFAULT 0,
  posted_at         TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_days ON jobs (posted_days_ago);
CREATE INDEX IF NOT EXISTS idx_jobs_role_family ON jobs (role_family);
CREATE INDEX IF NOT EXISTS idx_jobs_work_mode ON jobs (work_mode);
