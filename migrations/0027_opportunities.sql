-- First-class jobs versus gigs/contracts, plus the profile preference for
-- which lane a person wants FJ to prioritise.
ALTER TABLE jobs ADD COLUMN opportunity_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE jobs ADD COLUMN engagement_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE jobs ADD COLUMN engagement_label TEXT;
ALTER TABLE jobs ADD COLUMN engagement_basis TEXT;
ALTER TABLE jobs ADD COLUMN project_duration TEXT;
ALTER TABLE profiles ADD COLUMN opportunity_types TEXT NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_jobs_opportunity_open
  ON jobs (opportunity_type, job_status, posted_at DESC);
