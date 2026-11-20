-- "Open CEP" from OFBiz iCRM: the keys and time zone of iCRM's getSSOToken tokens. CEP stores no address: iCRM sends the
-- browser to its own cep.url, and CEP answers on that same address.
-- Needs patches 0083, 0086 and 0087_tenant_sso_config.sql. Idempotent: run it again to change a value. Changes take effect within a minute.
-- One iCRM system per workspace: for another system (Citi Staging...), add its workspace (tenant row, new code) and run this for that code.
--
-- 1. Replace the values in the DECLARE block below:
--      workspace     the CEP workspace code: iCRM's cep.tenant.code (NWA)
--      site_key      exactly iCRM TenantProperties security / common.site.key (iCRM CEP Configuration screen), character for character
--      api_key       exactly iCRM TenantProperties cep / cep.api.key (the decoded value the CEP Configuration screen shows)
--      time_zone     the iCRM server's time zone (IANA name): getSSOToken writes its expiry in it. Run `date` on the iCRM
--                    server: EST/EDT (staging, EST5EDT) is America/New_York, IST is Asia/Kolkata. A wrong zone makes
--                    every link look expired.
--      roles         iCRM's CEP role (security group CEP_MARKETING_ADMIN / CEP_CAMPAIGN_MANAGER / CEP_ANALYST, sent as
--                    cep_role) -> the CEP role of that name in this workspace. Change the names only if the workspace's
--                    roles are named differently (a workspace on CEP's default names calls its administrator role 'Workspace Admin').
--                    "Open CEP" creates the CEP user on their first visit and sets this role on every visit.
-- 2. Run as the database owner:  psql -X -1 -v ON_ERROR_STOP=1 -f database/ofbiz_sso_seed.sql
-- 3. Do not commit this file with real keys in it.
--
-- Stored in the tenant table, column sso_config (patch 0087): {"is_active": true, "secret_enc": "..."}
-- secret_enc gets {"site_key", "api_key", "time_zone", "roles"} as plain text; CEP encrypts it with FIELD_ENCRYPTION_KEY the
-- first time it reads it. No other column of the tenant row is changed. To switch "Open CEP" off for a workspace:
--   UPDATE tenant SET sso_config = jsonb_set(sso_config, '{is_active}', 'false') WHERE code = 'NWA';

DO $$
DECLARE
    workspace    CONSTANT TEXT := 'NWA';
    site_key     CONSTANT TEXT := 'PASTE-common.site.key';
    api_key      CONSTANT TEXT := 'PASTE-cep.api.key';
    time_zone    CONSTANT TEXT := 'America/New_York';
    roles        CONSTANT JSON := '{"MARKETING_ADMIN": "Marketing Admin", "CAMPAIGN_MANAGER": "Campaign Manager", "ANALYST": "Analyst"}';
    v_role       TEXT;
    v_tenant     UUID;
BEGIN
    IF site_key LIKE 'PASTE-%' OR api_key LIKE 'PASTE-%' OR site_key = '' OR api_key = ''
            OR site_key <> btrim(site_key) OR api_key <> btrim(api_key) THEN
        RAISE EXCEPTION 'Put iCRM''s common.site.key and cep.api.key in this file: no quotes, no spaces around them.';
    END IF;
    PERFORM now() AT TIME ZONE time_zone;                                -- an unknown time zone stops here

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
    UPDATE tenant SET sso_config = jsonb_build_object('is_active', TRUE, 'secret_enc',
        json_build_object('site_key', site_key, 'api_key', api_key, 'time_zone', time_zone, 'roles', roles)::text)
    WHERE id = v_tenant;
    RAISE NOTICE 'OFBiz sign-in set up for %', workspace;
END $$;
