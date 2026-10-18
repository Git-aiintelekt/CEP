-- 0060: sharing a dashboard with people and roles (dashboard_share), and row access rules (report_row_rule), apps/insights/access.py.
-- report_share already exists (patch 0049) and is now used. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
