-- 0056: Report Databases (apps/insights/databases.py): report_connection (a workspace's own MySQL or PostgreSQL databases, the password encrypted,
-- RLS) and report_dataset_custom (the datasets mapped from their tables and views); report.dataset_key no longer references the
-- platform's catalogue alone. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
