-- "Open CEP" from OFBiz iCRM: the two keys iCRM seals its getSSOToken tokens with. Settings -> Integrations -> Sign-On from
-- OFBiz iCRM sets the same two keys in the app; this file is for a workspace set up from the database.
-- Needs patches 0083, 0086 and 0087_tenant_sso_config.sql. Idempotent: run it again to change a value. Changes take effect within a minute.
-- One iCRM system per workspace: for another system (Citi Staging...), add its workspace (tenant row, new code) and run this for that code.
--
-- CEP stores nothing else:
--   address    iCRM sends the browser to its own cep.url, and CEP answers on that same address.
--   roles      iCRM's cep_role is the CEP role's name: MARKETING_ADMIN opens CEP as the workspace's role named "Marketing Admin"
--              (CAMPAIGN_MANAGER -> "Campaign Manager", ANALYST -> "Analyst"). Settings -> Roles must have a role of that name.
--   time zone  iCRM writes the token's expiry in its server's local time: CEP reads it in the workspace's own time zone, the
--              tenant.timezone column (America/New_York for NWA, as the iCRM staging server). It must match the iCRM server.
--
-- 1. Replace the values in the DECLARE block below:
--      workspace     the CEP workspace code: iCRM's cep.tenant.code (NWA)
--      site_key      exactly iCRM TenantProperties security / common.site.key (iCRM CEP Configuration screen), character for character
--      api_key       exactly iCRM TenantProperties cep / cep.api.key (the decoded value the CEP Configuration screen shows)
-- 2. Run as the database owner:  psql -X -1 -v ON_ERROR_STOP=1 -f database/ofbiz_sso_seed.sql
-- 3. Do not commit this file with real keys in it.
--
-- Stored in the tenant table, column sso_config (patch 0087): {"is_active": true, "secret_enc": "..."}
-- secret_enc gets {"site_key", "api_key"} as plain text; CEP encrypts it with FIELD_ENCRYPTION_KEY the first time it reads it.
-- No other column of the tenant row is changed. To switch "Open CEP" off for a workspace:
--   UPDATE tenant SET sso_config = jsonb_set(sso_config, '{is_active}', 'false') WHERE code = 'NWA';

DO $$
DECLARE
    workspace    CONSTANT TEXT := 'NWA';
    site_key     CONSTANT TEXT := 'PASTE-common.site.key';
    api_key      CONSTANT TEXT := 'PASTE-cep.api.key';
    v_role       TEXT;
    v_tenant     UUID;
BEGIN
    IF site_key LIKE 'PASTE-%' OR api_key LIKE 'PASTE-%' OR site_key = '' OR api_key = ''
            OR site_key <> btrim(site_key) OR api_key <> btrim(api_key) THEN
        RAISE EXCEPTION 'Put iCRM''s common.site.key and cep.api.key in this file: no quotes, no spaces around them.';
    END IF;

    SELECT id INTO v_tenant FROM fn_resolve_tenant('code', workspace);
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'No active workspace %.', workspace;
    END IF;

    PERFORM set_config('app.current_tenant', v_tenant::text, true);      -- row-level security
    FOREACH v_role IN ARRAY ARRAY['Marketing Admin', 'Campaign Manager', 'Analyst'] LOOP
        IF NOT EXISTS (SELECT 1 FROM role WHERE tenant_id = v_tenant AND lower(name) = lower(v_role) AND deleted_at IS NULL) THEN
            RAISE WARNING 'Workspace % has no role "%": iCRM users with that CEP role are refused until Settings -> Roles has one.', workspace, v_role;
        END IF;
    END LOOP;
    UPDATE tenant SET sso_config = jsonb_build_object('is_active', TRUE, 'secret_enc',
        json_build_object('site_key', site_key, 'api_key', api_key)::text)
    WHERE id = v_tenant;
    RAISE NOTICE 'OFBiz sign-in set up for %', workspace;
END $$;
