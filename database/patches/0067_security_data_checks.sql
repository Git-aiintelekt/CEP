-- 0067: the Security page's data checks (workspace isolation, accounts and keys, sending domains): security_finding.kind takes
-- DATABASE, ACCOUNT and MAIL. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
