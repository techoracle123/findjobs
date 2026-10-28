-- Fixed-window rate limiting.
--
-- The counters live in D1 so they survive a Worker restart and are shared
-- across every instance, which a per-instance memory cache would not be.

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
