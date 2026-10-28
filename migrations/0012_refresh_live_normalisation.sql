-- Re-fetch enabled sources once so old inferred salaries/dates are replaced by
-- the stricter live normaliser. No source is re-enabled against operator intent.
UPDATE sources SET last_run_at = NULL WHERE enabled = 1;
