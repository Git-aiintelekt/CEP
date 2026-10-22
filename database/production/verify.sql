-- Checks a database built by build_production_db.sh (and load_reference_data.sh, when it has run): it fails with the
-- reason when something a production installation needs is missing, and lists what is there.
--   psql -X -v ON_ERROR_STOP=1 -f database/production/verify.sql
\set ON_ERROR_STOP on
DO $$
DECLARE
    missing TEXT;
    parts TEXT;
BEGIN
    SELECT string_agg(code, ', ') INTO missing FROM unnest(ARRAY['campaign.view', 'campaign.edit', 'campaign.publish', 'campaign.approve',
        'journey.view', 'journey.edit', 'journey.activate', 'journey.export', 'journey.suppress', 'template.view', 'template.edit',
        'list.view', 'list.edit', 'list.import', 'governance.edit', 'provider.edit', 'report.view', 'report.edit', 'report.admin',
        'consent.edit', 'user.admin']) AS code WHERE NOT EXISTS (SELECT 1 FROM permission p WHERE p.code = code);
    IF missing IS NOT NULL THEN RAISE EXCEPTION 'permissions missing: %', missing; END IF;

    SELECT string_agg(pc.component_key, ', ' ORDER BY pc.component_key) INTO parts
      FROM subscription_plan p JOIN plan_component pc ON pc.plan_id = p.id WHERE p.code = 'INSIGHTS';
    IF parts IS DISTINCT FROM 'insights' THEN RAISE EXCEPTION 'the INSIGHTS plan should include Insights alone, it has: %', coalesce(parts, 'nothing'); END IF;

    IF NOT EXISTS (SELECT 1 FROM schema_patch) THEN RAISE EXCEPTION 'no patches recorded in schema_patch'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'django_session') THEN RAISE EXCEPTION 'Django''s tables are missing'; END IF;

    IF EXISTS (SELECT 1 FROM tenant WHERE code = 'PLATFORM') THEN
        IF NOT EXISTS (SELECT 1 FROM app_user u JOIN tenant t ON t.id = u.tenant_id
                        WHERE t.code = 'PLATFORM' AND u.is_staff AND u.is_platform_admin AND u.is_active) THEN
            RAISE EXCEPTION 'the PLATFORM workspace has no active platform administrator';
        END IF;
        IF EXISTS (SELECT 1 FROM role r WHERE r.tenant_id = (SELECT id FROM tenant WHERE code = 'PLATFORM') AND r.deleted_at IS NULL
                    AND NOT EXISTS (SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id)) THEN
            RAISE EXCEPTION 'a PLATFORM role has no permissions';
        END IF;
    END IF;
END $$;

SELECT 'permissions' AS what, count(*)::text AS value FROM permission
UNION ALL SELECT 'plans', string_agg(code, ', ' ORDER BY code) FROM subscription_plan
UNION ALL SELECT 'patches recorded', count(*)::text FROM schema_patch
UNION ALL SELECT 'workspaces', coalesce(string_agg(code, ', ' ORDER BY code), 'none') FROM tenant
UNION ALL SELECT 'platform administrators', coalesce(string_agg(email::text, ', '), 'none') FROM app_user WHERE is_platform_admin
UNION ALL SELECT 'staff need a second factor', value::text FROM platform_setting WHERE key = 'security.mfa_required_for_staff';
