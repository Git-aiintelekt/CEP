-- 0085 (2026-11-19): the time zones a workspace can be set to, as reference_code rows (code set tenant.timezone).
-- The back-office tenant form and the onboarding flow offer them in a searchable list instead of a free text box.
-- Re-runs the Platform Operations layer, which is idempotent: the rows are added with ON CONFLICT DO NOTHING.
-- Apply with database/apply_patch.sh 0085_timezones.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
