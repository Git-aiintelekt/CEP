-- "Open CEP" from OFBiz iCRM: the values that used to be the environment variables OFBIZ_SSO_SECRET and FRONTEND_URL.
-- Needs patch ofbiz_sso.sql. Idempotent: run it again to change a value. Changes take effect within a minute.
--
-- 1. Replace the three values in the "settings" block below:
--      workspace     the CEP workspace code OFBiz sends as `tenant` (NWA)
--      secret        exactly OFBiz TenantProperties cep.sso.secret, character for character, 32 or more characters.
--                    Generate one: python -c "import secrets; print(secrets.token_urlsafe(48))"
--      frontend_url  the address people open CEP at, https, no trailing slash. Also iCRM's cep.url.
-- 2. Run as the database owner:  psql -X -1 -v ON_ERROR_STOP=1 -f database/ofbiz_sso_seed.sql
-- 3. Do not commit this file with a real secret in it.
--
-- The secret goes in as plain text; CEP encrypts it with FIELD_ENCRYPTION_KEY the first time it reads it. To switch "Open CEP"
-- off for a workspace: UPDATE tenant_ofbiz_link SET is_active = FALSE (with app.current_tenant set, as below).

DO $$
DECLARE
    workspace    CONSTANT TEXT := 'NWA';
    secret       CONSTANT TEXT := 'test';
    frontend_url CONSTANT TEXT := 'https://cepdev.aiintelekt.com';
    v_tenant     UUID;
BEGIN
    IF secret LIKE 'PASTE-%' OR length(secret) < 32 OR secret <> btrim(secret) THEN
        RAISE EXCEPTION 'Put the OFBiz cep.sso.secret in this file: 32 or more characters, no quotes, no spaces around it.';
    END IF;
    IF frontend_url !~ '^https?://[^/]+$' THEN
        RAISE EXCEPTION 'frontend_url is the address only, such as https://cepdev.aiintelekt.com (no path, no trailing slash).';
    END IF;

    SELECT id INTO v_tenant FROM fn_resolve_tenant('code', workspace);
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'No active workspace %.', workspace;
    END IF;

    PERFORM set_config('app.current_tenant', v_tenant::text, true);      -- row-level security
    INSERT INTO tenant_ofbiz_link (tenant_id, secret_enc, is_active)
    VALUES (v_tenant, secret, TRUE)
    ON CONFLICT (tenant_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, is_active = TRUE;

    UPDATE platform_setting SET value = to_jsonb(frontend_url) WHERE key = 'platform.frontend_url';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'The parameter platform.frontend_url is missing: apply patch ofbiz_sso.sql first.';
    END IF;
    RAISE NOTICE 'OFBiz sign-in set up for % ; CEP opens at %', workspace, frontend_url;
END $$;
