-- 0093 (2026-11-21): blackout dates. communication_governance_policy and platform_governance_policy get blackout_from,
-- blackout_to and blackout_yearly: days with no marketing on any channel, in the workspace's time zone. A run due on one waits.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0093_governance_blackout_dates.sql
-- BEFORE deploying the code that reads the columns.
\ir ../CEP_Database_Schema_Platform_Operations.sql
