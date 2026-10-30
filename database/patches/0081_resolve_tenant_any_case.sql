-- 0081 (2026-10-30): fn_resolve_tenant matches the code, the subdomain and the custom domain in any case. A domain saved with
-- capitals in the back office (CG.example.com) was never found, since browsers send host names in lower case; and the code
-- matched exactly, though the lookup's cache key is lower case. The same function as the schema file. Idempotent.
-- Apply with database/apply_patch.sh 0081_resolve_tenant_any_case.sql, which also records it.
CREATE OR REPLACE FUNCTION fn_resolve_tenant(p_key TEXT, p_value TEXT)
RETURNS TABLE (id UUID, code VARCHAR, timezone VARCHAR, db_alias VARCHAR, db_status VARCHAR)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT t.id, t.code, t.timezone, COALESCE(d.db_alias, 'default')::varchar, COALESCE(d.status, 'ACTIVE')::varchar
    FROM tenant t
    LEFT JOIN tenant_database d ON d.tenant_id = t.id
    WHERE t.status = 'ACTIVE' AND t.deleted_at IS NULL
      AND CASE p_key WHEN 'code'              THEN upper(t.code) = upper(p_value)
                     WHEN 'subdomain'         THEN lower(t.subdomain) = lower(p_value)
                     WHEN 'custom_app_domain' THEN lower(t.custom_app_domain) = lower(p_value)
                     ELSE FALSE END
    LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) TO cep_app, cep_admin;
