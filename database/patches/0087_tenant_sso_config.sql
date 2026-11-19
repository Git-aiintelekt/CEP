-- 0087 (2026-11-19): "Open CEP" from OFBiz iCRM moves into a new column, tenant.sso_config = {"is_active", "secret_enc"}: one iCRM
-- system per workspace (another system gets its own tenant row and code). A value patch 0086 put in tenant.settings -> 'ofbiz_sso'
-- is copied there and removed from settings, so tenant.settings is as before. Idempotent.
-- Apply with database/apply_patch.sh 0087_tenant_sso_config.sql BEFORE deploying the code that reads the column.
\ir ../CEP_Database_Schema_Platform_Operations.sql
