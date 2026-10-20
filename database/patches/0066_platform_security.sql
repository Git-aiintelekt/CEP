-- 0066: the back-office Security page: security_check and security_finding (package advisories from OSV.dev, server settings and
-- site headers, kept across checks with fixed and accepted states) and the security.site_address setting. Idempotent: re-runs
-- the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
