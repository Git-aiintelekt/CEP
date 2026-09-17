-- Patch 0004: fn_resolve_tenant - tenant resolution for requests that have no tenant context yet. The registry is
-- hidden from cep_app by RLS until app.current_tenant is set, so the lookup is a SECURITY DEFINER function that
-- returns routing data only. Idempotent. Apply as the DDL owner.
BEGIN;

CREATE OR REPLACE FUNCTION fn_resolve_tenant(p_key TEXT, p_value TEXT)
RETURNS TABLE (id UUID, code VARCHAR, timezone VARCHAR, db_alias VARCHAR, db_status VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT t.id, t.code, t.timezone, COALESCE(d.db_alias, 'default')::varchar, COALESCE(d.status, 'ACTIVE')::varchar
    FROM tenant t
    LEFT JOIN tenant_database d ON d.tenant_id = t.id
    WHERE t.status = 'ACTIVE' AND t.deleted_at IS NULL
      AND CASE p_key WHEN 'code'              THEN t.code = p_value
                     WHEN 'subdomain'         THEN t.subdomain = lower(p_value)
                     WHEN 'custom_app_domain' THEN t.custom_app_domain = lower(p_value)
                     ELSE FALSE END
    LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) TO cep_app, cep_admin;

COMMIT;
