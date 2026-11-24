-- 0098 (2026-11-24): the same person in several workspaces. app_user is unique by (tenant_id, email) instead of email alone; staff and
-- platform administrators stay unique by email; tenant.environment (PRODUCTION, STAGING). Re-runs the Platform Operations layer, which
-- is idempotent. Apply with database/apply_patch.sh 0098_same_user_workspaces.sql BEFORE deploying the code of branch same-user-workspaces.
-- It cannot be undone once two workspaces hold the same address.
\ir ../CEP_Database_Schema_Platform_Operations.sql
