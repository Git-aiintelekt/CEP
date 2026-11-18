-- 0084 (2026-11-18): "Open CEP" from OFBiz iCRM moves from its own table, tenant_ofbiz_link (patch 0083), into the existing
-- tenant.settings, key 'ofbiz_sso' = {"is_active", "secret_enc"}, like the workspace's other settings. Each workspace's row is
-- copied there (unchanged: still encrypted, or plain until CEP first reads it), then tenant_ofbiz_link is dropped.
-- Idempotent. Apply with database/apply_patch.sh 0084_ofbiz_sso_in_tenant_settings.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
