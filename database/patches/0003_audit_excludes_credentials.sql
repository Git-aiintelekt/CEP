-- Patch 0003: password and API-key hashes are no longer copied into definition_audit_log (old_row / new_row);
-- existing audit rows are scrubbed. Idempotent. Apply as the DDL owner.
BEGIN;

CREATE OR REPLACE FUNCTION fn_definition_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_old     JSONB;
    v_new     JSONB;
    v_changed TEXT[];
    v_tenant  UUID;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
    -- child definition tables (journey_node, journey_connection, receipt_field_configuration, ...) carry no
    -- tenant_id column: the tenant comes from the RLS session setting every writer already has to set.
    v_tenant := COALESCE(v_new ->> 'tenant_id', v_old ->> 'tenant_id',
                         NULLIF(current_setting('app.current_tenant', true), ''))::uuid;
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'fn_definition_audit: no tenant context for % (row has no tenant_id and app.current_tenant is not set)', TG_TABLE_NAME
              USING ERRCODE = 'P0002';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key) INTO v_changed
        FROM jsonb_each(v_new) n
        WHERE v_old -> n.key IS DISTINCT FROM n.value;
        IF v_changed IS NULL OR v_changed = ARRAY['updated_at', 'row_version']::text[] THEN
            RETURN NULL;                                   -- nothing meaningful changed
        END IF;
    END IF;
    -- Credentials never enter the audit trail: the column name stays in changed_columns, its value does not.
    v_old := v_old - ARRAY['password_hash', 'key_hash'];
    v_new := v_new - ARRAY['password_hash', 'key_hash'];
    INSERT INTO definition_audit_log (tenant_id, entity_table, entity_id, action, changed_by, changed_columns, old_row, new_row)
    VALUES (
        v_tenant,
        TG_TABLE_NAME,
        COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'tenant_id', v_old ->> 'tenant_id'),   -- tenant_database & co. are keyed by tenant_id
        TG_OP,
        NULLIF(current_setting('app.current_user_id', true), '')::uuid,
        v_changed, v_old, v_new
    );
    RETURN NULL;
END $$;

UPDATE definition_audit_log
   SET old_row = old_row - ARRAY['password_hash', 'key_hash'],
       new_row = new_row - ARRAY['password_hash', 'key_hash']
 WHERE entity_table IN ('app_user', 'api_client')
   AND (old_row ?| ARRAY['password_hash', 'key_hash'] OR new_row ?| ARRAY['password_hash', 'key_hash']);

COMMIT;
