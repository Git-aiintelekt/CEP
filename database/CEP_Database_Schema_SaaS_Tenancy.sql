-- =====================================================================================
-- AI-InteleKt CEP — SAAS TENANCY & CDN LAYER
-- Target: PostgreSQL 18+   ·   Run AFTER CEP_Database_Schema.sql and CEP_Database_Schema_Enterprise_Hardening.sql
--
-- Tenancy model (SaaS from day one):
--   * ONE schema, deployed identically to the shared POOL database and to every DEDICATED database.
--   * Small tenants live in the pool: every high-volume table is PARTITION BY LIST (tenant_id) with
--     per-tenant sub-partitions (monthly RANGE, or HASH for list membership), plus RLS on every row.
--   * High-volume tenants get a DEDICATED database: same DDL, one tenant row, one set of partitions.
--   * The pool database also acts as the control plane: tenant registry, routing (tenant_database),
--     plans, subscriptions, metered usage and storage/CDN config. Dedicated databases carry a copy
--     of their own tenant row so every FK to tenant(id) still holds.
--   * Moving a tenant pool -> dedicated: fn_detach_tenant() -> pg_dump the detached tables ->
--     restore into the new database -> fn_attach_tenant() -> flip tenant_database.db_alias.
--
-- Sections:
--   1. Tenant registry & routing        tenant.* additions, tenant_database
--   2. Plans, subscriptions, usage      subscription_plan, tenant_subscription, tenant_usage
--   3. Storage & CDN                     tenant_storage_config, media_asset CDN columns
--   4. Partition lifecycle              partition_retention_policy + provision / monthly / retention / detach / attach
--   5. Constraints, RLS, triggers       for the tables above
-- =====================================================================================

-- =====================================================================================
-- 1. TENANT REGISTRY & ROUTING
-- =====================================================================================

ALTER TABLE tenant
    ADD COLUMN IF NOT EXISTS partition_seq INTEGER GENERATED ALWAYS AS IDENTITY UNIQUE,
    ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE,
    ADD COLUMN IF NOT EXISTS custom_app_domain VARCHAR(253) UNIQUE,
    ADD COLUMN IF NOT EXISTS isolation_mode VARCHAR(20) NOT NULL DEFAULT 'SHARED',
    ADD COLUMN IF NOT EXISTS region VARCHAR(40),
    ADD COLUMN IF NOT EXISTS data_residency VARCHAR(40),
    ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN tenant.partition_seq IS 'Short stable number used in partition names: <table>_t<partition_seq>_<YYYY_MM>';
COMMENT ON COLUMN tenant.subdomain IS 'Host-based tenant resolution: <subdomain>.cep.example.com';

CREATE TABLE tenant_database (
    tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
    isolation_mode      VARCHAR(20) NOT NULL DEFAULT 'SHARED',   -- SHARED (pool database, per-tenant partitions) | DEDICATED (own database)
    db_alias            VARCHAR(63) NOT NULL DEFAULT 'default',  -- Django DATABASES key selected by the tenant router
    db_host             VARCHAR(253),
    db_port             INTEGER,
    db_name             VARCHAR(63),
    db_secret_ref       VARCHAR(200),                            -- vault key for credentials; never the credential itself
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- PROVISIONING, ACTIVE, MIGRATING, READ_ONLY, DECOMMISSIONED
    migrated_from_alias VARCHAR(63),
    migrated_at         TIMESTAMPTZ,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1
);

-- =====================================================================================
-- 2. PLANS, SUBSCRIPTIONS, METERED USAGE
-- =====================================================================================

CREATE TABLE subscription_plan (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(30) NOT NULL UNIQUE,             -- STARTER, GROWTH, ENTERPRISE
    name                VARCHAR(100) NOT NULL,
    default_isolation_mode VARCHAR(20) NOT NULL DEFAULT 'SHARED', -- SHARED, DEDICATED
    max_contacts        BIGINT,
    max_messages_per_month BIGINT,
    max_users           INTEGER,
    max_storage_gb      INTEGER,
    features            JSONB NOT NULL DEFAULT '{}',            -- feature flags: journeys, ereceipt, ab_testing, custom_domain ...
    monthly_price       NUMERIC(12,2),
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1
);
INSERT INTO subscription_plan (code, name, default_isolation_mode, max_contacts, max_messages_per_month, max_users, max_storage_gb, features) VALUES
    ('STARTER',    'Starter',    'SHARED',    250000,    1000000,  10,  25,  '{"journeys": true, "ereceipt": false, "ab_testing": false, "custom_domain": false}'),
    ('GROWTH',     'Growth',     'SHARED',    2000000,   10000000, 50,  100, '{"journeys": true, "ereceipt": true,  "ab_testing": true,  "custom_domain": true}'),
    ('ENTERPRISE', 'Enterprise', 'DEDICATED', NULL,      NULL,     NULL, NULL, '{"journeys": true, "ereceipt": true,  "ab_testing": true,  "custom_domain": true, "dedicated_db": true}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE tenant_subscription (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    plan_id             UUID NOT NULL REFERENCES subscription_plan(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'TRIAL',    -- TRIAL, ACTIVE, PAST_DUE, CANCELLED
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    trial_ends_at       TIMESTAMPTZ,
    ends_at             TIMESTAMPTZ,
    billing_customer_ref VARCHAR(100),                           -- e.g. Stripe customer id
    billing_subscription_ref VARCHAR(100),                       -- e.g. Stripe subscription id
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_tenant_subscription_active ON tenant_subscription(tenant_id) WHERE status IN ('TRIAL', 'ACTIVE');

CREATE TABLE tenant_usage (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    period_month        DATE NOT NULL,                           -- first day of the month
    metric              VARCHAR(30) NOT NULL,                    -- EMAIL_SENT, SMS_SENT, MMS_SENT, CONTACTS, STORAGE_BYTES, API_CALLS
    value               BIGINT NOT NULL DEFAULT 0,               -- rolled up by analytics workers from execution tables / storage
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, period_month, metric)
);

-- =====================================================================================
-- 3. STORAGE & CDN — object storage behind a CDN; per-tenant prefix, optional custom asset domain.
--    Objects are content-addressed (sha256 in the key) so they are immutable and cache forever;
--    a changed file is a new object, never an overwrite, so no CDN purge is ever required.
-- =====================================================================================

CREATE TABLE tenant_storage_config (
    tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
    storage_backend     VARCHAR(10) NOT NULL DEFAULT 'S3',       -- S3, R2, GCS, AZURE
    bucket_name         VARCHAR(63) NOT NULL,
    bucket_region       VARCHAR(40),
    base_prefix         VARCHAR(200) NOT NULL,                   -- t/<partition_seq>/ — every object of the tenant under one prefix
    cdn_base_url        TEXT NOT NULL,                           -- https://cdn.cep.example.com
    custom_asset_domain VARCHAR(253),                            -- assets.client-brand.com (CNAME to the CDN distribution)
    custom_domain_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, ACTIVE, FAILED (TLS certificate + DNS validated)
    signed_url_ttl_seconds INTEGER NOT NULL DEFAULT 900,          -- PRIVATE assets: presigned URL lifetime
    max_upload_bytes    BIGINT NOT NULL DEFAULT 26214400,        -- 25 MB
    allowed_mime_types  TEXT[] NOT NULL DEFAULT '{image/jpeg,image/png,image/gif,image/webp,image/svg+xml,application/pdf,text/csv}',
    image_renditions    JSONB NOT NULL DEFAULT '{"thumb": 200, "email": 600, "retina": 1200, "mms": 640}', -- label -> max width px
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE media_asset
    ADD COLUMN IF NOT EXISTS asset_kind VARCHAR(20) NOT NULL DEFAULT 'IMAGE',
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'PUBLIC',
    ADD COLUMN IF NOT EXISTS cdn_url TEXT,
    ADD COLUMN IF NOT EXISTS cache_control VARCHAR(100) NOT NULL DEFAULT 'public, max-age=31536000, immutable',
    ADD COLUMN IF NOT EXISTS etag VARCHAR(80),
    ADD COLUMN IF NOT EXISTS variants JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS scan_status VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS uploaded_via VARCHAR(20) NOT NULL DEFAULT 'API';
COMMENT ON COLUMN media_asset.asset_kind IS 'IMAGE, DOCUMENT, LIST_UPLOAD, RECEIPT_LOGO, MMS_MEDIA, EXPORT';
COMMENT ON COLUMN media_asset.visibility IS 'PUBLIC = served from the CDN by stable URL; PRIVATE = presigned URL with signed_url_ttl_seconds';
COMMENT ON COLUMN media_asset.cdn_url IS 'The URL placed in rendered email/MMS content: <cdn_base_url or custom_asset_domain>/<storage_key>';
COMMENT ON COLUMN media_asset.variants IS 'Generated renditions: {"email": {"url":..., "width":600, "bytes":...}, ...}';
COMMENT ON COLUMN media_asset.scan_status IS 'PENDING, CLEAN, INFECTED, SKIPPED — uploaded documents are scanned before they become downloadable';
CREATE INDEX ix_media_asset_kind ON media_asset(tenant_id, asset_kind) WHERE deleted_at IS NULL;

-- =====================================================================================
-- 4. PARTITION LIFECYCLE — one declared policy per partitioned table drives everything:
--    fn_provision_tenant()            create a tenant's partitions in whichever database hosts it
--    fn_ensure_monthly_partitions()   nightly: create upcoming monthly sub-partitions
--    fn_apply_partition_retention()   nightly: drop / detach expired monthly sub-partitions
--    fn_detach_tenant() / fn_attach_tenant()   move a tenant between pool and dedicated databases
--    Partition naming: <table>_t<partition_seq>  ->  <table>_t<seq>_<YYYY_MM>  or  <table>_t<seq>_p<n>
-- =====================================================================================

CREATE TABLE partition_retention_policy (
    table_name          VARCHAR(63) PRIMARY KEY,
    tenant_partitioned  BOOLEAN NOT NULL DEFAULT TRUE,           -- top level is LIST (tenant_id)
    sub_method          VARCHAR(20) NOT NULL,                    -- RANGE_MONTHLY, HASH
    sub_key             VARCHAR(63) NOT NULL,                    -- column the tenant partition is sub-partitioned on
    hash_modulus        INTEGER,                                 -- HASH only
    retention_months    INTEGER,                                 -- NULL = keep forever
    expiry_action       VARCHAR(10) NOT NULL DEFAULT 'DETACH',   -- DROP, DETACH (detached partitions are archived by ops)
    note                TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO partition_retention_policy (table_name, sub_method, sub_key, hash_modulus, retention_months, expiry_action, note) VALUES
    ('contact_list_member', 'HASH', 'contact_list_id', 8, NULL, 'DETACH', 'Hash-partitioned by list within the tenant; no time-based expiry'),
    ('campaign_list_member', 'RANGE_MONTHLY', 'created_at', NULL, 24, 'DROP', 'Execution population; superseded by mailer/sms execution history'),
    ('journey_node_execution', 'RANGE_MONTHLY', 'executed_at', NULL, 24, 'DROP', 'Operational journey history; analytical master keeps the flattened record'),
    ('journey_event', 'RANGE_MONTHLY', 'occurred_at', NULL, 12, 'DROP', 'Raw inbound trigger events'),
    ('governance_evaluation_log', 'RANGE_MONTHLY', 'evaluated_at', NULL, 12, 'DROP', 'Governance decision audit'),
    ('mailer_execution', 'RANGE_MONTHLY', 'created_at', NULL, 24, 'DETACH', 'Detach, not drop: attribution / CLV analysis needs send history'),
    ('sms_execution', 'RANGE_MONTHLY', 'created_at', NULL, 24, 'DETACH', 'Detach, not drop: attribution / CLV analysis needs send history'),
    ('delivery_webhook_event', 'RANGE_MONTHLY', 'received_at', NULL, 6, 'DROP', 'Raw provider payloads; results already applied to execution rows'),
    ('journey_execution_master_analytical', 'RANGE_MONTHLY', 'executed_at', NULL, 36, 'DETACH', 'Reporting fact table'),
    ('dead_letter_message', 'RANGE_MONTHLY', 'first_failed_at', NULL, 12, 'DROP', 'Failed-send review queue'),
    ('definition_audit_log', 'RANGE_MONTHLY', 'changed_at', NULL, 84, 'DETACH', '7-year change-history retention for compliance'),
    ('contact_list_import_row', 'RANGE_MONTHLY', 'created_at', NULL, 3, 'DROP', 'Transient import staging; contains raw uploaded PII'),
    ('consent_record', 'RANGE_MONTHLY', 'occurred_at', NULL, NULL, 'DETACH', 'Consent proof — kept indefinitely (retention_months NULL)')
ON CONFLICT (table_name) DO NOTHING;

-- RLS hides the registry from cep_app until app.current_tenant is set, so tenant resolution runs as SECURITY
-- DEFINER and returns routing data only (no settings, no billing, no secrets).
-- fn: resolves a request to its tenant before any tenant context exists (by code, subdomain or custom domain)
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

-- fn: canonical name of a tenant's partition of a table: <table>_t<partition_seq>
CREATE OR REPLACE FUNCTION fn_tenant_partition_name(p_table TEXT, p_tenant UUID)
RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT format('%s_t%s', p_table, partition_seq) FROM tenant WHERE id = p_tenant
$$;

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

-- fn: creates a tenant's LIST partition (+ HASH children or first monthly partitions) for every partitioned table
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

-- fn: drops or detaches monthly sub-partitions older than each table's retention_months, for every tenant in this database
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

-- fn: detaches every partition of a tenant (pool -> dedicated migration step 1); returns the detached table names to dump
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

-- fn: attaches a tenant's restored partition tables in the target database (pool -> dedicated migration step 3)
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

-- =====================================================================================
-- 5. CONSTRAINTS, ROW-LEVEL SECURITY AND TRIGGERS FOR THE TABLES ABOVE
-- =====================================================================================

ALTER TABLE tenant ADD CONSTRAINT ck_tenant_isolation_mode CHECK (isolation_mode IN ('SHARED', 'DEDICATED'));
ALTER TABLE tenant_database ADD CONSTRAINT ck_tenant_database_isolation_mode CHECK (isolation_mode IN ('SHARED', 'DEDICATED'));
ALTER TABLE tenant_database ADD CONSTRAINT ck_tenant_database_status CHECK (status IN ('PROVISIONING', 'ACTIVE', 'MIGRATING', 'READ_ONLY', 'DECOMMISSIONED'));
ALTER TABLE subscription_plan ADD CONSTRAINT ck_subscription_plan_default_isolation_mode CHECK (default_isolation_mode IN ('SHARED', 'DEDICATED'));
ALTER TABLE tenant_subscription ADD CONSTRAINT ck_tenant_subscription_status CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED'));
ALTER TABLE tenant_usage ADD CONSTRAINT ck_tenant_usage_metric CHECK (metric IN ('EMAIL_SENT', 'SMS_SENT', 'MMS_SENT', 'CONTACTS', 'STORAGE_BYTES', 'API_CALLS'));
ALTER TABLE tenant_storage_config ADD CONSTRAINT ck_tenant_storage_config_storage_backend CHECK (storage_backend IN ('S3', 'R2', 'GCS', 'AZURE'));
ALTER TABLE tenant_storage_config ADD CONSTRAINT ck_tenant_storage_config_custom_domain_status CHECK (custom_domain_status IN ('PENDING', 'ACTIVE', 'FAILED'));
ALTER TABLE media_asset ADD CONSTRAINT ck_media_asset_asset_kind CHECK (asset_kind IN ('IMAGE', 'DOCUMENT', 'LIST_UPLOAD', 'RECEIPT_LOGO', 'MMS_MEDIA', 'EXPORT'));
ALTER TABLE media_asset ADD CONSTRAINT ck_media_asset_visibility CHECK (visibility IN ('PUBLIC', 'PRIVATE'));
ALTER TABLE media_asset ADD CONSTRAINT ck_media_asset_scan_status CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'));
ALTER TABLE media_asset ADD CONSTRAINT ck_media_asset_uploaded_via CHECK (uploaded_via IN ('API', 'DIRECT_UPLOAD', 'SYSTEM'));
ALTER TABLE partition_retention_policy ADD CONSTRAINT ck_partition_retention_policy_sub_method CHECK (sub_method IN ('RANGE_MONTHLY', 'HASH'));
ALTER TABLE partition_retention_policy ADD CONSTRAINT ck_partition_retention_policy_expiry_action CHECK (expiry_action IN ('DROP', 'DETACH'));
ALTER TABLE partition_retention_policy ADD CONSTRAINT ck_retention_months CHECK (retention_months IS NULL OR retention_months > 0);
ALTER TABLE partition_retention_policy ADD CONSTRAINT ck_hash_modulus CHECK (sub_method <> 'HASH' OR hash_modulus > 0);
ALTER TABLE tenant_storage_config ADD CONSTRAINT ck_storage_limits CHECK (signed_url_ttl_seconds > 0 AND max_upload_bytes > 0);
ALTER TABLE tenant_subscription ADD CONSTRAINT ck_subscription_dates CHECK (ends_at IS NULL OR started_at IS NULL OR ends_at >= started_at);
ALTER TABLE tenant_usage ADD CONSTRAINT ck_usage_period CHECK (period_month = date_trunc('month', period_month)::date);

-- reference_code labels for this layer's value sets (table created in the hardening layer)
INSERT INTO reference_code (code_set, code, label, sort_order) VALUES
    ('tenant.isolation_mode', 'SHARED', 'Shared', 1),
    ('tenant.isolation_mode', 'DEDICATED', 'Dedicated', 2),
    ('tenant_database.isolation_mode', 'SHARED', 'Shared', 1),
    ('tenant_database.isolation_mode', 'DEDICATED', 'Dedicated', 2),
    ('tenant_database.status', 'PROVISIONING', 'Provisioning', 1),
    ('tenant_database.status', 'ACTIVE', 'Active', 2),
    ('tenant_database.status', 'MIGRATING', 'Migrating', 3),
    ('tenant_database.status', 'READ_ONLY', 'Read Only', 4),
    ('tenant_database.status', 'DECOMMISSIONED', 'Decommissioned', 5),
    ('subscription_plan.default_isolation_mode', 'SHARED', 'Shared', 1),
    ('subscription_plan.default_isolation_mode', 'DEDICATED', 'Dedicated', 2),
    ('tenant_subscription.status', 'TRIAL', 'Trial', 1),
    ('tenant_subscription.status', 'ACTIVE', 'Active', 2),
    ('tenant_subscription.status', 'PAST_DUE', 'Past Due', 3),
    ('tenant_subscription.status', 'CANCELLED', 'Cancelled', 4),
    ('tenant_usage.metric', 'EMAIL_SENT', 'Email Sent', 1),
    ('tenant_usage.metric', 'SMS_SENT', 'Sms Sent', 2),
    ('tenant_usage.metric', 'MMS_SENT', 'Mms Sent', 3),
    ('tenant_usage.metric', 'CONTACTS', 'Contacts', 4),
    ('tenant_usage.metric', 'STORAGE_BYTES', 'Storage Bytes', 5),
    ('tenant_usage.metric', 'API_CALLS', 'Api Calls', 6),
    ('tenant_storage_config.storage_backend', 'S3', 'S3', 1),
    ('tenant_storage_config.storage_backend', 'R2', 'R2', 2),
    ('tenant_storage_config.storage_backend', 'GCS', 'Gcs', 3),
    ('tenant_storage_config.storage_backend', 'AZURE', 'Azure', 4),
    ('tenant_storage_config.custom_domain_status', 'PENDING', 'Pending', 1),
    ('tenant_storage_config.custom_domain_status', 'ACTIVE', 'Active', 2),
    ('tenant_storage_config.custom_domain_status', 'FAILED', 'Failed', 3),
    ('media_asset.asset_kind', 'IMAGE', 'Image', 1),
    ('media_asset.asset_kind', 'DOCUMENT', 'Document', 2),
    ('media_asset.asset_kind', 'LIST_UPLOAD', 'List Upload', 3),
    ('media_asset.asset_kind', 'RECEIPT_LOGO', 'Receipt Logo', 4),
    ('media_asset.asset_kind', 'MMS_MEDIA', 'Mms Media', 5),
    ('media_asset.asset_kind', 'EXPORT', 'Export', 6),
    ('media_asset.visibility', 'PUBLIC', 'Public', 1),
    ('media_asset.visibility', 'PRIVATE', 'Private', 2),
    ('media_asset.scan_status', 'PENDING', 'Pending', 1),
    ('media_asset.scan_status', 'CLEAN', 'Clean', 2),
    ('media_asset.scan_status', 'INFECTED', 'Infected', 3),
    ('media_asset.scan_status', 'SKIPPED', 'Skipped', 4),
    ('media_asset.uploaded_via', 'API', 'Api', 1),
    ('media_asset.uploaded_via', 'DIRECT_UPLOAD', 'Direct Upload', 2),
    ('media_asset.uploaded_via', 'SYSTEM', 'System', 3),
    ('partition_retention_policy.sub_method', 'RANGE_MONTHLY', 'Range Monthly', 1),
    ('partition_retention_policy.sub_method', 'HASH', 'Hash', 2),
    ('partition_retention_policy.expiry_action', 'DROP', 'Drop', 1),
    ('partition_retention_policy.expiry_action', 'DETACH', 'Detach', 2)
ON CONFLICT (code_set, code) DO NOTHING;

-- Catalog documentation for this layer's tables
COMMENT ON TABLE tenant_database IS 'Routing record: which database (shared pool or dedicated) hosts the tenant; drives the Django DB router';
COMMENT ON TABLE subscription_plan IS 'Plan catalogue: tier limits, default isolation mode, feature flags, price';
COMMENT ON TABLE tenant_subscription IS 'Tenant''s current plan, lifecycle status and billing references';
COMMENT ON TABLE tenant_usage IS 'Monthly metered usage per tenant (emails, SMS, contacts, storage) for quotas and invoicing';
COMMENT ON TABLE tenant_storage_config IS 'Object-storage bucket, CDN base URL, custom asset domain, upload rules and image renditions per tenant';
COMMENT ON TABLE partition_retention_policy IS 'Per-table partition scheme and retention; drives provisioning, monthly creation, expiry and tenant migration functions';
CREATE INDEX ix_tenant_subscription_plan_id ON tenant_subscription(plan_id);

-- A tenant sees only its own registry row; routing lookups run as cep_admin.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tenant_self ON tenant
    USING (id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tenant_database ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_database FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tenant_database_tenant ON tenant_database
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tenant_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tenant_subscription_tenant ON tenant_subscription
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tenant_usage_tenant ON tenant_usage
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tenant_storage_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_storage_config FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tenant_storage_config_tenant ON tenant_storage_config
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE TRIGGER trg_tenant_database_touch BEFORE UPDATE ON tenant_database FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_subscription_plan_touch BEFORE UPDATE ON subscription_plan FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_tenant_subscription_touch BEFORE UPDATE ON tenant_subscription FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_tenant_storage_config_touch BEFORE UPDATE ON tenant_storage_config FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_tenant_usage_touch BEFORE UPDATE ON tenant_usage FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_partition_retention_policy_touch BEFORE UPDATE ON partition_retention_policy FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_tenant_database_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_database FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_tenant_subscription_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_subscription FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_tenant_storage_config_audit AFTER INSERT OR UPDATE OR DELETE ON tenant_storage_config FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cep_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cep_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO cep_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cep_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO cep_admin;

-- Partitions are reached only through their parent (privileges are checked on the parent); the application role
-- gets no direct access to them, so RLS on the parent cannot be side-stepped by naming a tenant's partition.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relispartition AND c.relkind IN ('r', 'p') LOOP
        EXECUTE format('REVOKE ALL ON %I FROM cep_app', r.relname);
    END LOOP;
END $$;
-- Lifecycle functions run as SECURITY DEFINER (owned by the DDL role): the worker calls them as cep_app,
-- detach/attach (tenant moves) stay with cep_admin.
REVOKE EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention(), fn_detach_tenant(UUID), fn_attach_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention() TO cep_app;
GRANT EXECUTE ON FUNCTION fn_provision_tenant(UUID, INTEGER), fn_ensure_monthly_partitions(INTEGER, UUID),
    fn_apply_partition_retention(), fn_detach_tenant(UUID), fn_attach_tenant(UUID) TO cep_admin;
REVOKE EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_resolve_tenant(TEXT, TEXT) TO cep_app, cep_admin;

-- =====================================================================================
-- End of SaaS tenancy & CDN layer.
-- =====================================================================================
