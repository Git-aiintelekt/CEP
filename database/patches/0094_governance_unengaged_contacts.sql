-- 0094 (2026-11-21): unengaged contacts. communication_governance_policy and platform_governance_policy get unengaged_days and
-- unengaged_min_emails (marketing email leaves out people with no engagement in that many days); campaign gets include_unengaged
-- (a win-back campaign reaches them); attributed_order gets an index by person for the purchase check.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0094_governance_unengaged_contacts.sql
-- BEFORE deploying the code that reads the columns.
\ir ../CEP_Database_Schema_Platform_Operations.sql
