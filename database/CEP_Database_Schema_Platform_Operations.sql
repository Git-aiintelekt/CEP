-- =====================================================================================
-- AI-InteleKt CEP  ·  PLATFORM OPERATIONS LAYER  (apply 5th, after Hybrid Services)
-- =====================================================================================
-- Billing, tenant lifecycle operations, job monitoring and alerts, support access, sign-in
-- security (MFA, single sign-on) and the global parameters / industry profiles that switch
-- product features on and off per tenant.
--
-- Idempotent (IF NOT EXISTS / OR REPLACE / DROP-then-ADD): the same file creates the layer in
-- a new database and upgrades an existing one. Apply as the DDL owner.
--
--   tenant-scoped, row-level security      tenant_invoice · tenant_identity_provider · support_access_log
--   platform-only (no access for cep_app)  tenant_operation · job_run · platform_alert
--   platform-owned, readable by cep_app    platform_setting · industry_profile
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. BILLING: overage prices on the plan, monthly invoices per tenant
-- -------------------------------------------------------------------------------------
ALTER TABLE subscription_plan
    ADD COLUMN IF NOT EXISTS overage_per_1k_messages NUMERIC(10,4),      -- NULL = no overage: sending stops at the limit
    ADD COLUMN IF NOT EXISTS overage_per_1k_contacts NUMERIC(10,4);
COMMENT ON COLUMN subscription_plan.overage_per_1k_messages IS 'Price per 1,000 messages above max_messages_per_month; NULL = hard limit, sending stops';
COMMENT ON COLUMN subscription_plan.overage_per_1k_contacts IS 'Price per 1,000 contacts above max_contacts; NULL = hard limit';

UPDATE subscription_plan SET overage_per_1k_messages = 0.9000, overage_per_1k_contacts = 4.0000
 WHERE code = 'GROWTH' AND overage_per_1k_messages IS NULL;              -- STARTER stays hard-capped; ENTERPRISE is unlimited

CREATE TABLE IF NOT EXISTS tenant_invoice (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    invoice_number      VARCHAR(40) NOT NULL UNIQUE,                     -- INV-<tenant code>-<YYYYMM>
    period_month        DATE NOT NULL,                                   -- first day of the billed month
    plan_code           VARCHAR(30) NOT NULL,                            -- snapshot: the plan may change later
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    base_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    overage_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_items          JSONB NOT NULL DEFAULT '[]',                     -- [{description, quantity, unit_price, amount}]
    usage_snapshot      JSONB NOT NULL DEFAULT '{}',                     -- metric -> value the invoice was computed from
    status              VARCHAR(10) NOT NULL DEFAULT 'DRAFT',            -- DRAFT, ISSUED, PAID, VOID
    issued_at           TIMESTAMPTZ,
    due_at              TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    external_ref        VARCHAR(100),                                    -- id in the payment provider, when one is connected
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, period_month),
    CONSTRAINT ck_tenant_invoice_status CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'VOID')),
    CONSTRAINT ck_tenant_invoice_total CHECK (total_amount = base_amount + overage_amount AND total_amount >= 0)
);
COMMENT ON TABLE tenant_invoice IS 'One invoice per tenant and month: plan price plus metered overage, computed from tenant_usage';
CREATE INDEX IF NOT EXISTS ix_tenant_invoice_status ON tenant_invoice(status, period_month);

-- -------------------------------------------------------------------------------------
-- 2. TENANT LIFECYCLE OPERATIONS: export, move to a dedicated database, offboarding
-- -------------------------------------------------------------------------------------
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS ck_tenant_status;
ALTER TABLE tenant ADD CONSTRAINT ck_tenant_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'OFFBOARDED'));

CREATE TABLE IF NOT EXISTS tenant_operation (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    operation           VARCHAR(30) NOT NULL,                            -- EXPORT, MOVE_TO_DEDICATED, PURGE_SOURCE, OFFBOARD
    status              VARCHAR(12) NOT NULL DEFAULT 'REQUESTED',        -- REQUESTED, RUNNING, SUCCEEDED, FAILED, CANCELLED
    parameters          JSONB NOT NULL DEFAULT '{}',                     -- target alias, export directory, ...
    progress            JSONB NOT NULL DEFAULT '[]',                     -- [{at, step, detail}] appended while running
    result              JSONB NOT NULL DEFAULT '{}',                     -- row counts per table, archive path and checksum
    error               TEXT,
    requested_by        UUID REFERENCES app_user(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tenant_operation_operation CHECK (operation IN ('EXPORT', 'MOVE_TO_DEDICATED', 'PURGE_SOURCE', 'OFFBOARD')),
    CONSTRAINT ck_tenant_operation_status CHECK (status IN ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
);
COMMENT ON TABLE tenant_operation IS 'Runbook record of a long-running tenant operation: who asked, every step taken, the outcome';
CREATE INDEX IF NOT EXISTS ix_tenant_operation_tenant ON tenant_operation(tenant_id, requested_at DESC);
-- one destructive / exclusive operation per tenant at a time
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_operation_running ON tenant_operation(tenant_id) WHERE status IN ('REQUESTED', 'RUNNING');

-- -------------------------------------------------------------------------------------
-- 3. JOB MONITORING AND ALERTS
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_run (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_name            VARCHAR(100) NOT NULL,
    status              VARCHAR(10) NOT NULL DEFAULT 'RUNNING',          -- RUNNING, SUCCEEDED, FAILED
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    duration_ms         INTEGER,
    result              JSONB,
    error               TEXT,
    worker              VARCHAR(200),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_job_run_status CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);
COMMENT ON TABLE job_run IS 'One row per execution of a scheduled job; the health page reads the newest success per job';
CREATE INDEX IF NOT EXISTS ix_job_run_name_started ON job_run(job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS platform_alert (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    check_name          VARCHAR(100) NOT NULL,                           -- health check or job name
    severity            VARCHAR(10) NOT NULL,                            -- WARN, FAIL
    summary             TEXT NOT NULL,
    detail              TEXT,
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_notified_at    TIMESTAMPTZ,
    notifications       INTEGER NOT NULL DEFAULT 0,
    resolved_at         TIMESTAMPTZ,
    acknowledged_by     UUID REFERENCES app_user(id),
    acknowledged_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_platform_alert_severity CHECK (severity IN ('WARN', 'FAIL'))
);
COMMENT ON TABLE platform_alert IS 'An open alert per failing health check: opened once, re-notified on a schedule, closed when the check recovers';
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_alert_open ON platform_alert(check_name) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_platform_alert_opened ON platform_alert(opened_at DESC);

-- -------------------------------------------------------------------------------------
-- 4. SUPPORT ACCESS ("sign in as this user")
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_access_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    staff_user_id       UUID NOT NULL REFERENCES app_user(id),           -- the platform operator
    target_user_id      UUID NOT NULL REFERENCES app_user(id),           -- the account they acted as
    reason              TEXT NOT NULL,                                   -- ticket number / what the customer asked for
    access_mode         VARCHAR(10) NOT NULL DEFAULT 'READ',             -- READ (default) or WRITE
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL,
    ended_at            TIMESTAMPTZ,                                     -- ended early by the operator
    ip_address          INET,
    requests            INTEGER NOT NULL DEFAULT 0,
    writes              INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_support_access_mode CHECK (access_mode IN ('READ', 'WRITE')),
    CONSTRAINT ck_support_access_reason CHECK (length(btrim(reason)) >= 5),
    CONSTRAINT ck_support_access_window CHECK (expires_at > started_at)
);
COMMENT ON TABLE support_access_log IS 'Every support session in which platform staff acted as a tenant user: who, as whom, why, for how long. Visible to the tenant.';
CREATE INDEX IF NOT EXISTS ix_support_access_tenant ON support_access_log(tenant_id, started_at DESC);
-- Staff usually belong to another tenant, whose app_user rows row-level security hides from this one: the log carries the name.
ALTER TABLE support_access_log ADD COLUMN IF NOT EXISTS staff_name VARCHAR(200);
COMMENT ON COLUMN support_access_log.staff_name IS 'Display name of the platform operator at the time (their app_user row is invisible to the tenant under RLS)';

-- -------------------------------------------------------------------------------------
-- 5. SIGN-IN SECURITY: multi-factor authentication and single sign-on
-- -------------------------------------------------------------------------------------
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS mfa_secret_enc      TEXT,                   -- TOTP secret, encrypted by the application (never plain)
    ADD COLUMN IF NOT EXISTS mfa_confirmed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mfa_recovery_hashes TEXT[] NOT NULL DEFAULT '{}',   -- SHA-256 of unused one-time recovery codes
    ADD COLUMN IF NOT EXISTS mfa_last_counter    BIGINT;                 -- last accepted TOTP time-step: a code cannot be replayed
COMMENT ON COLUMN app_user.mfa_secret_enc IS 'TOTP secret encrypted with the application field key; mfa_enabled turns true only after a code is confirmed';
COMMENT ON COLUMN app_user.mfa_recovery_hashes IS 'Hashes of unused recovery codes; a code is removed when used';

CREATE TABLE IF NOT EXISTS tenant_identity_provider (
    tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
    protocol            VARCHAR(10) NOT NULL DEFAULT 'OIDC',
    display_name        VARCHAR(100) NOT NULL DEFAULT 'Single sign-on',  -- button text: "Sign in with <display_name>"
    issuer              TEXT NOT NULL,                                   -- https://login.microsoftonline.com/<tenant>/v2.0 ...
    client_id           TEXT NOT NULL,
    client_secret_enc   TEXT,                                            -- encrypted by the application; NULL for public clients (PKCE only)
    scopes              VARCHAR(200) NOT NULL DEFAULT 'openid email profile',
    allowed_email_domains TEXT[] NOT NULL DEFAULT '{}',                  -- empty = any address the IdP vouches for
    jit_provisioning    BOOLEAN NOT NULL DEFAULT FALSE,                  -- create unknown users on first sign-in
    default_role_id     UUID REFERENCES role(id),                        -- role given to users created that way
    enforce_sso         BOOLEAN NOT NULL DEFAULT FALSE,                  -- password sign-in refused (administrators keep break-glass access)
    is_active           BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_tenant_idp_protocol CHECK (protocol IN ('OIDC')),
    CONSTRAINT ck_tenant_idp_issuer CHECK (issuer ~ '^https://'),
    CONSTRAINT ck_tenant_idp_jit_role CHECK (NOT jit_provisioning OR default_role_id IS NOT NULL)
);
COMMENT ON TABLE tenant_identity_provider IS 'A tenant''s OpenID Connect identity provider (Entra ID, Okta, Google Workspace, ...): one per tenant';

-- -------------------------------------------------------------------------------------
-- 6. GLOBAL PARAMETERS AND INDUSTRY PROFILES
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_setting (
    key                 VARCHAR(100) PRIMARY KEY,                        -- dotted: security.password_link_hours
    value               JSONB NOT NULL,
    value_type          VARCHAR(10) NOT NULL DEFAULT 'STRING',           -- STRING, INTEGER, DECIMAL, BOOLEAN, LIST, OBJECT
    category            VARCHAR(40) NOT NULL DEFAULT 'General',
    description         TEXT NOT NULL,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_platform_setting_type CHECK (value_type IN ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'LIST', 'OBJECT')),
    CONSTRAINT ck_platform_setting_key CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);
COMMENT ON TABLE platform_setting IS 'Global parameters of the installation, changed in the back-office without a deployment. Never secrets: those stay in the environment.';

CREATE TABLE IF NOT EXISTS industry_profile (
    code                VARCHAR(30) PRIMARY KEY,                         -- RETAIL, HOSPITALITY, FINANCIAL_SERVICES, ...
    name                VARCHAR(100) NOT NULL,
    description         TEXT,
    features            JSONB NOT NULL DEFAULT '{}',                     -- feature code -> true / false (a missing key = the feature's default)
    terminology         JSONB NOT NULL DEFAULT '{}',                     -- customer / store / receipt ... -> the word this industry uses
    defaults            JSONB NOT NULL DEFAULT '{}',                     -- default solicitation type, quiet hours, ...
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_industry_profile_code CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
    CONSTRAINT ck_industry_profile_features CHECK (jsonb_typeof(features) = 'object' AND jsonb_typeof(terminology) = 'object')
);
COMMENT ON TABLE industry_profile IS 'Which product features a kind of business gets by default, and what it calls things. A tenant names its profile in tenant.settings.industry.';

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('security.password_link_hours',      '72',     'INTEGER', 'Security',   'Hours a one-time password link stays valid'),
    ('security.support_access_minutes',   '30',     'INTEGER', 'Security',   'Length of a support ("sign in as") session'),
    ('security.notify_user_on_support_access', 'true', 'BOOLEAN', 'Security', 'Email the user when platform staff open a support session on their account'),
    ('security.mfa_required_for_staff',   'false',  'BOOLEAN', 'Security',   'Platform staff must use multi-factor authentication (switch on once every staff member has enrolled)'),
    ('billing.invoice_due_days',          '14',     'INTEGER', 'Billing',    'Days between issuing an invoice and its due date'),
    ('billing.usage_warning_percent',     '80',     'INTEGER', 'Billing',    'Warn a tenant when usage reaches this share of a plan limit'),
    ('alerts.recipients',                 '[]',     'LIST',    'Alerts',     'Email addresses that receive platform alerts'),
    ('alerts.webhook_url',                '""',     'STRING',  'Alerts',     'Slack-compatible incoming webhook for platform alerts (optional)'),
    ('alerts.renotify_minutes',           '240',    'INTEGER', 'Alerts',     'Repeat the notification for an alert that is still open after this many minutes'),
    ('tenancy.default_industry',          '"GENERIC"', 'STRING', 'Tenancy',  'Industry profile given to a tenant that does not name one'),
    ('tenancy.offboarding_export_days',   '30',     'INTEGER', 'Tenancy',    'Days an offboarding export archive is kept before it may be deleted'),
    ('messaging.max_upload_mb',           '5',      'INTEGER', 'Messaging',  'Largest image upload, in MB')
ON CONFLICT (key) DO NOTHING;

INSERT INTO industry_profile (code, name, description, features, terminology, defaults, sort_order) VALUES
    ('GENERIC', 'General business', 'Every channel, no industry-specific features',
        '{"ereceipt": false, "loyalty": false}', '{}', '{}', 0),
    ('RETAIL', 'Retail', 'Stores and e-commerce: e-receipts, loyalty, promotions',
        '{"ereceipt": true, "loyalty": true, "mms": true}', '{"location": "store", "transaction": "purchase"}', '{"solicitation_type": "MARKETING"}', 10),
    ('HOSPITALITY', 'Hospitality and travel', 'Hotels, restaurants, travel: guests and stays',
        '{"ereceipt": true, "loyalty": true, "mms": false}', '{"customer": "guest", "location": "property", "transaction": "stay"}', '{}', 20),
    ('FINANCIAL_SERVICES', 'Financial services', 'Banks, insurers, lenders: service and legal notices first',
        '{"ereceipt": false, "loyalty": false, "mms": false, "ab_testing": false}', '{"customer": "client", "location": "branch"}', '{"solicitation_type": "SERVICE"}', 30),
    ('HEALTHCARE', 'Healthcare', 'Clinics and providers: appointment and service messages',
        '{"ereceipt": false, "loyalty": false, "mms": false, "ab_testing": false}', '{"customer": "patient", "location": "clinic", "transaction": "appointment"}', '{"solicitation_type": "SERVICE"}', 40)
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 7. MAINTENANCE TRIGGERS, ROW-LEVEL SECURITY, GRANTS
-- -------------------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['tenant_invoice', 'tenant_identity_provider'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_touch_row()', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_definition_audit()', t, t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['platform_setting', 'industry_profile'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at()', t, t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['tenant_invoice', 'tenant_identity_provider', 'support_access_log', 'tenant_operation'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%s_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%s_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;

-- credentials never enter the audit trail (identity provider secret and SMTP password join the password and key hashes)
CREATE OR REPLACE FUNCTION fn_definition_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_old     JSONB;
    v_new     JSONB;
    v_changed TEXT[];
    v_tenant  UUID;
    v_secret  TEXT[] := ARRAY['password_hash', 'key_hash', 'client_secret_enc', 'mfa_secret_enc', 'mfa_recovery_hashes', 'password_enc'];
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := to_jsonb(OLD); END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := to_jsonb(NEW); END IF;
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
        IF v_changed IS NULL OR v_changed <@ ARRAY['updated_at', 'row_version', 'updated_by', 'last_login_at', 'mfa_last_counter']::text[] THEN
            RETURN NULL;                                   -- nothing meaningful changed (sign-ins are not definition changes)
        END IF;
    END IF;
    v_old := v_old - v_secret;
    v_new := v_new - v_secret;
    INSERT INTO definition_audit_log (tenant_id, entity_table, entity_id, action, changed_by, changed_columns, old_row, new_row)
    VALUES (
        v_tenant,
        TG_TABLE_NAME,
        COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'tenant_id', v_old ->> 'tenant_id'),
        TG_OP,
        NULLIF(current_setting('app.current_user_id', true), '')::uuid,
        v_changed, v_old, v_new
    );
    RETURN NULL;
END $$;

-- The API role reads parameters and profiles but never changes them; it has no business in the operations tables.
REVOKE INSERT, UPDATE, DELETE ON platform_setting, industry_profile FROM cep_app;
GRANT SELECT ON platform_setting, industry_profile TO cep_app;
REVOKE ALL ON tenant_operation, job_run, platform_alert FROM cep_app;
GRANT ALL ON tenant_invoice, tenant_operation, job_run, platform_alert, support_access_log, tenant_identity_provider, platform_setting, industry_profile TO cep_admin;
-- invoices are produced by the platform, read by the tenant
REVOKE INSERT, UPDATE, DELETE ON tenant_invoice FROM cep_app;
-- the tenant reads its support access log; only the platform writes it
REVOKE INSERT, UPDATE, DELETE ON support_access_log FROM cep_app;

-- -------------------------------------------------------------------------------------
-- 8. MAIL SERVERS
--    SMTP details entered in the product: one row per tenant (Settings -> Email server) and one platform row
--    (tenant_id NULL, back-office -> Configuration -> Mail server). The platform row may be shared with tenants,
--    who then send with their own From address through it. Passwords are encrypted by the application
--    (FIELD_ENCRYPTION_KEY) and never enter the audit trail. Row-level security hides the platform row from the
--    API role (NULL never equals the current tenant).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_server (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID REFERENCES tenant(id),                      -- NULL: the platform's own server
    host                VARCHAR(253) NOT NULL DEFAULT '',                -- '' on a tenant row that uses the shared platform server
    port                INTEGER NOT NULL DEFAULT 587,
    security            VARCHAR(10) NOT NULL DEFAULT 'STARTTLS',         -- NONE, STARTTLS (587), SSL (465)
    username            VARCHAR(200),
    password_enc        TEXT,
    from_email          CITEXT NOT NULL,
    from_name           VARCHAR(150),
    reply_to            CITEXT,
    use_platform_server BOOLEAN NOT NULL DEFAULT FALSE,                  -- tenant row: send through the shared platform server
    shared_with_all     BOOLEAN NOT NULL DEFAULT FALSE,                  -- platform row: every tenant may use it
    shared_tenant_ids   UUID[] NOT NULL DEFAULT '{}',                    -- platform row: or only these tenants
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_tested_at      TIMESTAMPTZ,
    last_test_ok        BOOLEAN,
    last_test_error     TEXT,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_mail_server_security CHECK (security IN ('NONE', 'STARTTLS', 'SSL')),
    CONSTRAINT ck_mail_server_port CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT ck_mail_server_host CHECK (use_platform_server OR host <> ''),
    CONSTRAINT ck_mail_server_platform_row CHECK (tenant_id IS NOT NULL OR NOT use_platform_server)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mail_server_tenant ON mail_server(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mail_server_platform ON mail_server((tenant_id IS NULL)) WHERE tenant_id IS NULL;
COMMENT ON TABLE mail_server IS 'SMTP servers entered in the product: one per tenant, plus the platform''s own (tenant_id NULL), which may be shared with tenants';

DROP TRIGGER IF EXISTS trg_mail_server_touch ON mail_server;
CREATE TRIGGER trg_mail_server_touch BEFORE UPDATE ON mail_server FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
-- tenant rows are audited under their tenant; the platform row has no tenant and is not
DROP TRIGGER IF EXISTS trg_mail_server_audit ON mail_server;
CREATE TRIGGER trg_mail_server_audit AFTER INSERT OR UPDATE ON mail_server FOR EACH ROW
    WHEN (NEW.tenant_id IS NOT NULL) EXECUTE FUNCTION fn_definition_audit();
DROP TRIGGER IF EXISTS trg_mail_server_audit_delete ON mail_server;
CREATE TRIGGER trg_mail_server_audit_delete AFTER DELETE ON mail_server FOR EACH ROW
    WHEN (OLD.tenant_id IS NOT NULL) EXECUTE FUNCTION fn_definition_audit();
ALTER TABLE mail_server ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_server FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_mail_server_tenant ON mail_server;
CREATE POLICY rls_mail_server_tenant ON mail_server
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_server TO cep_app;
GRANT ALL ON mail_server TO cep_admin;

-- =====================================================================================
-- End of platform operations layer.
-- =====================================================================================
