-- 0092 (2026-11-21): send windows. communication_governance_policy and platform_governance_policy get window_start,
-- window_end and window_days: when marketing of a channel may go out, in the workspace's time zone. A run due outside waits.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0092_governance_send_windows.sql
-- BEFORE deploying the code that reads the columns.
\ir ../CEP_Database_Schema_Platform_Operations.sql
