-- 0088 (2026-11-20): frequency caps the platform applies to one, several or all workspaces (platform_governance_policy),
-- copied into each workspace's communication_governance_policy and linked by platform_policy_id. The workspace's new
-- Governance page shows the copies locked beside its own caps.
-- Re-runs the Platform Operations layer, which is idempotent. Apply with database/apply_patch.sh 0088_governance_platform_policies.sql.
\ir ../CEP_Database_Schema_Platform_Operations.sql
