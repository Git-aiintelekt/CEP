-- Patch 0002: partition maintenance functions become SECURITY DEFINER (callable by cep_app, e.g. the Celery

-- beat jobs) and the application role loses direct access to partitions (RLS on the parent cannot be bypassed

-- by naming a tenant's partition). Idempotent. Apply as the DDL owner (superuser / cep_admin member).

BEGIN;

CREATE OR REPLACE FUNCTION fn_ensure_monthly_partitions(p_months_ahead INTEGER DEFAULT 3, p_tenant UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t         RECORD;
    r         RECORD;
    v_part    TEXT;
    v_child   TEXT;
    v_month   DATE;
    v_created INTEGER := 0;
BEGIN
    FOR t IN SELECT id FROM tenant
             WHERE (p_tenant IS NULL AND status = 'ACTIVE') OR id = p_tenant LOOP
        FOR r IN SELECT table_name FROM partition_retention_policy
                 WHERE is_active AND tenant_partitioned AND sub_method = 'RANGE_MONTHLY' LOOP
            v_part := fn_tenant_partition_name(r.table_name, t.id);
            IF to_regclass(v_part) IS NULL THEN
                CONTINUE;                                     -- tenant not provisioned in this database
            END IF;
            FOR i IN 0 .. p_months_ahead LOOP
                v_month := (date_trunc('month', now()) + (i * INTERVAL '1 month'))::date;
                v_child := format('%s_%s', v_part, to_char(v_month, 'YYYY_MM'));
                IF to_regclass(v_child) IS NULL THEN
                    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                                   v_child, v_part, v_month, (v_month + INTERVAL '1 month')::date);
                    EXECUTE format('REVOKE ALL ON %I FROM cep_app', v_child);   -- reachable through the parent only
                    v_created := v_created + 1;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    RETURN v_created;
END $$;

CREATE OR REPLACE FUNCTION fn_provision_tenant(p_tenant UUID, p_months_ahead INTEGER DEFAULT 3)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r         RECORD;
    v_part    TEXT;
    v_created INTEGER := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tenant WHERE id = p_tenant) THEN
        RAISE EXCEPTION 'tenant % is not registered in this database', p_tenant;
    END IF;
    FOR r IN SELECT * FROM partition_retention_policy WHERE is_active AND tenant_partitioned LOOP
        v_part := fn_tenant_partition_name(r.table_name, p_tenant);
        IF to_regclass(v_part) IS NOT NULL THEN
            CONTINUE;
        END IF;
        IF r.sub_method = 'HASH' THEN
            EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES IN (%L) PARTITION BY HASH (%I)',
                           v_part, r.table_name, p_tenant, r.sub_key);
            FOR i IN 0 .. r.hash_modulus - 1 LOOP
                EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES WITH (MODULUS %s, REMAINDER %s)',
                               format('%s_p%s', v_part, i), v_part, r.hash_modulus, i);
                EXECUTE format('REVOKE ALL ON %I FROM cep_app', format('%s_p%s', v_part, i));
            END LOOP;
        ELSE
            EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES IN (%L) PARTITION BY RANGE (%I)',
                           v_part, r.table_name, p_tenant, r.sub_key);
        END IF;
        EXECUTE format('REVOKE ALL ON %I FROM cep_app', v_part);                -- reachable through the parent only
        v_created := v_created + 1;
    END LOOP;
    PERFORM fn_ensure_monthly_partitions(p_months_ahead, p_tenant);
    RETURN v_created;
END $$;

CREATE OR REPLACE FUNCTION fn_apply_partition_retention()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t         RECORD;
    r         RECORD;
    c         RECORD;
    v_part    TEXT;
    v_cutoff  DATE;
    v_month   DATE;
    v_expired INTEGER := 0;
BEGIN
    FOR t IN SELECT id FROM tenant LOOP
        FOR r IN SELECT table_name, retention_months, expiry_action FROM partition_retention_policy
                 WHERE is_active AND tenant_partitioned AND sub_method = 'RANGE_MONTHLY' AND retention_months IS NOT NULL LOOP
            v_part := fn_tenant_partition_name(r.table_name, t.id);
            IF to_regclass(v_part) IS NULL THEN
                CONTINUE;
            END IF;
            v_cutoff := (date_trunc('month', now()) - (r.retention_months * INTERVAL '1 month'))::date;
            FOR c IN SELECT child.relname
                     FROM pg_inherits i
                     JOIN pg_class child  ON child.oid = i.inhrelid
                     JOIN pg_class parent ON parent.oid = i.inhparent
                     WHERE parent.relname = v_part LOOP
                IF c.relname ~ '_\d{4}_\d{2}$' THEN
                    v_month := to_date(right(c.relname, 7), 'YYYY_MM');
                    IF v_month < v_cutoff THEN
                        IF r.expiry_action = 'DROP' THEN
                            EXECUTE format('DROP TABLE %I', c.relname);
                        ELSE
                            EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', v_part, c.relname);
                        END IF;
                        v_expired := v_expired + 1;
                    END IF;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    RETURN v_expired;
END $$;

CREATE OR REPLACE FUNCTION fn_detach_tenant(p_tenant UUID)
RETURNS TEXT[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r          RECORD;
    v_part     TEXT;
    v_detached TEXT[] := ARRAY[]::TEXT[];
BEGIN
    FOR r IN SELECT table_name FROM partition_retention_policy WHERE is_active AND tenant_partitioned LOOP
        v_part := fn_tenant_partition_name(r.table_name, p_tenant);
        IF to_regclass(v_part) IS NOT NULL AND EXISTS (
            SELECT 1 FROM pg_inherits i JOIN pg_class p ON p.oid = i.inhparent JOIN pg_class c ON c.oid = i.inhrelid
            WHERE p.relname = r.table_name AND c.relname = v_part) THEN
            EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', r.table_name, v_part);
            v_detached := v_detached || v_part;
        END IF;
    END LOOP;
    RETURN v_detached;
END $$;

CREATE OR REPLACE FUNCTION fn_attach_tenant(p_tenant UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    r          RECORD;
    v_part     TEXT;
    v_attached INTEGER := 0;
BEGIN
    FOR r IN SELECT table_name FROM partition_retention_policy WHERE is_active AND tenant_partitioned LOOP
        v_part := fn_tenant_partition_name(r.table_name, p_tenant);
        IF to_regclass(v_part) IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE c.relname = v_part) THEN
            EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I FOR VALUES IN (%L)', r.table_name, v_part, p_tenant);
            v_attached := v_attached + 1;
        END IF;
    END LOOP;
    RETURN v_attached;
END $$;

DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relispartition AND c.relkind IN ('r', 'p') LOOP
        EXECUTE format('REVOKE ALL ON %I FROM cep_app', r.relname);
    END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention(), fn_detach_tenant(UUID), fn_attach_tenant(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention() TO cep_app;

GRANT EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention(), fn_detach_tenant(UUID), fn_attach_tenant(UUID) TO cep_admin;

COMMIT;
