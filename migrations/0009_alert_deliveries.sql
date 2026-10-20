-- Which alerts have already been delivered for which roles.
--
-- Without this, every refresh would send the same role again. A delivery is
-- recorded once, and a role that reopens is delivered again because it
-- earns a new event.

CREATE TABLE IF NOT EXISTS alert_deliveries (
  alert_id     TEXT NOT NULL,
  job_id       TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'telegram',
  delivered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (alert_id, job_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_job ON alert_deliveries (job_id);
