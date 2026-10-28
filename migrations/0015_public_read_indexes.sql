-- Ordered public pages should not sort the entire corpus for every visitor.
CREATE INDEX IF NOT EXISTS idx_jobs_public_order ON jobs(posted_at DESC, id)
WHERE is_demo = 0 AND expired_at IS NULL AND job_status = 'open';
CREATE INDEX IF NOT EXISTS idx_jobs_public_country ON jobs(location_country, posted_at DESC, id)
WHERE is_demo = 0 AND expired_at IS NULL AND job_status = 'open';
CREATE INDEX IF NOT EXISTS idx_jobs_public_seen ON jobs(datetime(last_seen_at))
WHERE is_demo = 0 AND expired_at IS NULL AND job_status = 'open';
CREATE INDEX IF NOT EXISTS idx_jobs_source_status ON jobs(source_id, job_status);
