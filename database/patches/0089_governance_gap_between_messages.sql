-- 0089 (2026-11-20): Gap Between Messages. communication_governance_policy and platform_governance_policy get gap_hours: a policy
-- with it skips a person who received a marketing message of its channel in the last gap_hours hours (1 to 168).
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0089_governance_gap_between_messages.sql
-- BEFORE deploying the code that reads the column.
\ir ../CEP_Database_Schema_Platform_Operations.sql
