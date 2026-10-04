-- Patch 0034: monthly partitions no longer depend on the session's time zone. fn_ensure_monthly_partitions passed plain
-- dates, read in the session's zone: the dev server's partitions up to December 2026 were made in a US Eastern session
-- (they end at 04:00 / 05:00 UTC), and the job, now running in UTC, could not create January 2027 ("would overlap").
-- New months start at 00:00 UTC, or exactly where an existing neighbouring month ends / begins. Existing partitions
-- are left as they are. Idempotent: CREATE OR REPLACE only. Apply as the DDL owner.

BEGIN;

-- fn: one bound of a monthly sub-partition ('FROM' or 'TO'), as the instant it is; NULL when the partition does not exist
CREATE OR REPLACE FUNCTION fn_partition_bound(p_child TEXT, p_side TEXT)
RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT (regexp_match(pg_get_expr(c.relpartbound, c.oid),
                         CASE WHEN p_side = 'FROM' THEN 'FROM \(''([^'']+)''\)' ELSE 'TO \(''([^'']+)''\)' END))[1]::timestamptz
      FROM pg_class c
     WHERE c.oid = to_regclass(p_child) AND c.relispartition
$$;

-- fn: creates the monthly sub-partitions of every tenant for the current month and p_months_ahead after it.
-- A month runs from 00:00 UTC on its first day, whatever the session's time zone. When a neighbouring month already
-- exists (partitions made earlier in another time zone end at, say, 05:00 UTC), the new month starts where the previous
-- one ends and ends where the next one starts, so months never overlap and never leave a gap.
CREATE OR REPLACE FUNCTION fn_ensure_monthly_partitions(p_months_ahead INTEGER DEFAULT 3, p_tenant UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    t         RECORD;
    r         RECORD;
    v_part    TEXT;
    v_child   TEXT;
    v_month   DATE;
    v_from    TIMESTAMPTZ;
    v_to      TIMESTAMPTZ;
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
                v_month := (date_trunc('month', now() AT TIME ZONE 'UTC') + (i * INTERVAL '1 month'))::date;
                v_child := format('%s_%s', v_part, to_char(v_month, 'YYYY_MM'));
                IF to_regclass(v_child) IS NULL THEN
                    v_from := coalesce(fn_partition_bound(format('%s_%s', v_part, to_char(v_month - INTERVAL '1 month', 'YYYY_MM')), 'TO'),
                                       v_month::timestamp AT TIME ZONE 'UTC');
                    v_to := coalesce(fn_partition_bound(format('%s_%s', v_part, to_char(v_month + INTERVAL '1 month', 'YYYY_MM')), 'FROM'),
                                     (v_month + INTERVAL '1 month')::timestamp AT TIME ZONE 'UTC');
                    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)', v_child, v_part, v_from, v_to);
                    EXECUTE format('REVOKE ALL ON %I FROM cep_app', v_child);   -- reachable through the parent only
                    v_created := v_created + 1;
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
    RETURN v_created;
END $$;

COMMIT;
