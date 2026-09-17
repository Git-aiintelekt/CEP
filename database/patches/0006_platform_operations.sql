-- Patch 0006: platform operations layer (billing, tenant operations, job monitoring and alerts, support access,
-- MFA / SSO, global parameters and industry profiles). The layer file is idempotent, so the patch simply runs it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
