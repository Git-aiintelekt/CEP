-- "Open CEP" from OFBiz iCRM: the keys and time zone of iCRM's getSSOToken tokens, and the address CEP opens at.
-- Needs patch ofbiz_sso.sql. Idempotent: run it again to change a value. Changes take effect within a minute.
--
-- 1. Replace the five values in the "settings" block below:
--      workspace     the CEP workspace code: iCRM's cep.tenant.code (NWA)
--      site_key      exactly iCRM TenantProperties security / common.site.key, character for character
--      api_key       exactly iCRM TenantProperties security / common.api.key, character for character
--      time_zone     the iCRM server's time zone (IANA name): getSSOToken writes its expiry in it. Run `date` on the iCRM
--                    server: EST/EDT (staging, EST5EDT) is America/New_York, IST is Asia/Kolkata. A wrong zone makes
--                    every link look expired.
--      frontend_url  the address people open CEP at, https, no trailing slash. Also iCRM's cep.url.
--      roles         iCRM's CEP role (security group CEP_WORKSPACE_ADMIN / CEP_CAMPAIGN_MANAGER / CEP_ANALYST, sent as
--                    cep_role) -> the CEP role of that name in this workspace. Change the names only if the workspace's
--                    roles are named differently (the NWA demo data calls its administrator role 'Marketing Admin').
--                    "Open CEP" creates the CEP user on their first visit and sets this role on every visit.
-- 2. Run as the database owner:  psql -X -1 -v ON_ERROR_STOP=1 -f database/ofbiz_sso_seed.sql
-- 3. Do not commit this file with real keys in it.
--
-- tenant_ofbiz_link.secret_enc gets {"site_key", "api_key", "time_zone", "roles"} as plain text; CEP encrypts it with FIELD_ENCRYPTION_KEY
-- the first time it reads it. To switch "Open CEP" off for a workspace: UPDATE tenant_ofbiz_link SET is_active = FALSE
-- (with app.current_tenant set, as below).

DO $$
DECLARE
    workspace    CONSTANT TEXT := 'NWA';
    site_key     CONSTANT TEXT := 'PASTE-common.site.key';
    api_key      CONSTANT TEXT := 'PASTE-common.api.key';
    time_zone    CONSTANT TEXT := 'America/New_York';
    frontend_url CONSTANT TEXT := 'https://cepdev.aiintelekt.com';
    roles        CONSTANT JSON := '{"WORKSPACE_ADMIN": "Workspace Admin", "CAMPAIGN_MANAGER": "Campaign Manager", "ANALYST": "Analyst"}';
    v_role       TEXT;
    v_tenant     UUID;
BEGIN
    IF site_key LIKE 'PASTE-%' OR api_key LIKE 'PASTE-%' OR site_key = '' OR api_key = ''
            OR site_key <> btrim(site_key) OR api_key <> btrim(api_key) THEN
        RAISE EXCEPTION 'Put iCRM''s common.site.key and common.api.key in this file: no quotes, no spaces around them.';
    END IF;
    PERFORM now() AT TIME ZONE time_zone;                                -- an unknown time zone stops here
    IF frontend_url !~ '^https?://[^/]+$' THEN
        RAISE EXCEPTION 'frontend_url is the address only, such as https://cepdev.aiintelekt.com (no path, no trailing slash).';
    END IF;

    SELECT id INTO v_tenant FROM fn_resolve_tenant('code', workspace);
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'No active workspace %.', workspace;
    END IF;

    PERFORM set_config('app.current_tenant', v_tenant::text, true);      -- row-level security
    FOR v_role IN SELECT value FROM json_each_text(roles) LOOP
        IF NOT EXISTS (SELECT 1 FROM role WHERE tenant_id = v_tenant AND lower(name) = lower(v_role) AND deleted_at IS NULL) THEN
            RAISE EXCEPTION 'Workspace % has no role "%": fix the roles setting in this file.', workspace, v_role;
        END IF;
    END LOOP;
    INSERT INTO tenant_ofbiz_link (tenant_id, secret_enc, is_active)
    VALUES (v_tenant, json_build_object('site_key', site_key, 'api_key', api_key, 'time_zone', time_zone, 'roles', roles)::text, TRUE)
    ON CONFLICT (tenant_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, is_active = TRUE;

    UPDATE platform_setting SET value = to_jsonb(frontend_url) WHERE key = 'platform.frontend_url';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The parameter platform.frontend_url is missing: apply patch ofbiz_sso.sql first.';
    END IF;
    RAISE NOTICE 'OFBiz sign-in set up for % ; CEP opens at %', workspace, frontend_url;
END $$;
