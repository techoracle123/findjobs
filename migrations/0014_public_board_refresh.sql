-- The Greenhouse adapter now uses the documented public JSON endpoint, rather
-- than a website URL returning HTML. Retry automatically failed ACTIVE boards;
-- never re-enable an operator-disabled source.
UPDATE sources SET consecutive_failures = 0, disabled_reason = NULL, last_run_at = NULL
WHERE adapter = 'greenhouse' AND enabled = 1
  AND (disabled_reason IS NULL OR disabled_reason = 'disabled after 5 consecutive failures');

-- Retire cached data from the attribution-required FX provider. Conversion now
-- uses CC0 open currency data with an independent central-bank fallback.
DELETE FROM service_cache WHERE key = 'fx-usd';

-- Source content hashes now include the live-v3 normalization version. Schedule
-- active, non-failing sources again so their existing jobs receive those rules.
UPDATE sources SET last_run_at = NULL WHERE enabled = 1 AND consecutive_failures < 5;
