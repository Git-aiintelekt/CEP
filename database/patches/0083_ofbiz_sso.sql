-- 0083 (2026-11-16): "Open CEP" from OFBiz iCRM is configured in the database, not the environment. tenant_ofbiz_link holds each
-- workspace's shared secret (encrypted by the application; row-level security); the global parameter platform.frontend_url
-- is the address CEP sends the browser to after checking an OFBiz link. Apply with database/apply_patch.sh 0083_ofbiz_sso.sql,
-- which also records it, then add the values with database/seeds/ofbiz_sso_seed.sql.
\ir ../CEP_Database_Schema_Platform_Operations.sql
