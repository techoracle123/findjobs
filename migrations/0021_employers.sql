-- Prompt 9: employer organisations.
-- An org owns its job posts; membership is per user; domain ownership is
-- proved by a DNS TXT record checked over DNS-over-HTTPS.

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  domain_token TEXT,
  domain_verified_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | suspended
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- owner | member
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS org_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  remote INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | live | hidden
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_jobs_org ON org_jobs(org_id, status);
