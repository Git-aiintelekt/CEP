-- 0027: the platform's mail server is for the platform's own mail only. The sharing columns on mail_server
-- (use_platform_server, shared_with_all, shared_tenant_ids) go; a tenant row that sent through the platform server is
-- removed with its campaign sender. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
