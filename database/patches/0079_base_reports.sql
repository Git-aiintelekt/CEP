-- 0079 (2026-10-26): Base Reports. report_base_install: the base packs a workspace added from the platform's catalogue (Email Campaign
-- Reports first), with the version, the database it reads and what it made. Row-level security; the application inserts and reads.
-- Apply with database/apply_patch.sh 0079_base_reports.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
