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
    ADD COLUMN IF NOT EXISTS overage_per_1k_contacts NUMERIC(10,4),
    ADD COLUMN IF NOT EXISTS max_deliverability_tests_per_month INTEGER;  -- inbox previews a workspace may run in a month; NULL = unlimited
COMMENT ON COLUMN subscription_plan.max_deliverability_tests_per_month IS 'Deliverability tests (inbox previews) a workspace may request in a calendar month; NULL = unlimited';
UPDATE subscription_plan SET max_deliverability_tests_per_month = CASE code WHEN 'STARTER' THEN 10 WHEN 'GROWTH' THEN 50 END
 WHERE max_deliverability_tests_per_month IS NULL AND code IN ('STARTER', 'GROWTH');      -- ENTERPRISE is unlimited
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
    ('security.idle_timeout_minutes',     '120',    'INTEGER', 'Security',   'Minutes of no activity in the browser before the frontend warns of a coming sign-out'),
    ('security.idle_warning_seconds',     '60',     'INTEGER', 'Security',   'Seconds the inactivity warning stays up before the frontend signs the person out'),
    ('billing.invoice_due_days',          '14',     'INTEGER', 'Billing',    'Days between issuing an invoice and its due date'),
    ('billing.usage_warning_percent',     '80',     'INTEGER', 'Billing',    'Warn a tenant when usage reaches this share of a plan limit'),
    ('alerts.recipients',                 '[]',     'LIST',    'Alerts',     'Email addresses that receive platform alerts'),
    ('alerts.webhook_url',                '""',     'STRING',  'Alerts',     'Slack-compatible incoming webhook for platform alerts (optional)'),
    ('alerts.renotify_minutes',           '240',    'INTEGER', 'Alerts',     'Repeat the notification for an alert that is still open after this many minutes'),
    ('tenancy.default_industry',          '"GENERIC"', 'STRING', 'Tenancy',  'Industry profile given to a tenant that does not name one'),
    ('tenancy.offboarding_export_days',   '30',     'INTEGER', 'Tenancy',    'Days an offboarding export archive is kept before it may be deleted'),
    ('messaging.max_upload_mb',           '5',      'INTEGER', 'Messaging',  'Largest image upload, in MB'),
    ('legal.copyright_holder',           '"Transaction Tree"', 'STRING', 'Legal', 'Whose copyright the footer of every page carries, after the current year'),
    ('legal.terms_of_use',               $terms$"## 1. What CEP is\n\nCEP is a customer engagement platform for email, text and e-receipt messaging, provided to your organisation under its subscription agreement. These terms apply to everyone who signs in to a CEP workspace.\n\n## 2. Your account\n\nYour account is personal. Keep your password and your authenticator to yourself, sign out on shared computers, and tell your workspace administrator at once if you believe someone else has used your account. Your organisation decides who may sign in and what each person may do.\n\n## 3. Acceptable use\n\nSend only to people who have agreed to hear from your organisation, honour every unsubscribe and STOP request, and follow the laws that apply to marketing messages where your recipients are. Do not upload content you have no right to use, and do not use CEP to send anything unlawful, misleading or harmful.\n\n## 4. Customer data\n\nThe customer records, lists and messages in a workspace belong to the organisation that owns the workspace. The platform processes them only to provide the service, keeps them in the workspace's own database, and never sells them. Consent records, suppressions and the trail of what was sent are kept so that the organisation can show where every address came from.\n\n## 5. Availability\n\nThe platform aims to be available at all times but is provided as it is. Planned maintenance is announced in advance where possible. Message delivery depends on the sending engines and the recipients' providers, which the platform does not control.\n\n## 6. Liability\n\nTo the extent the law allows, the platform provider is not liable for indirect or consequential loss arising from the use of CEP, including loss of revenue from messages that were delayed, held back or not delivered. Nothing in these terms limits liability that cannot be limited by law.\n\n## 7. Changes to these terms\n\nThese terms may change. The date at the top of this page says when they last changed; continuing to use CEP after a change means accepting it.\n\n## 8. Contact\n\nQuestions about these terms go to your workspace administrator, who can raise them with the platform team."$terms$, 'STRING', 'Legal', 'The Terms of Use page linked from the sign-in page and every footer, in Markdown (headings with ##, paragraphs, lists)'),
    ('platform.api_public_url',           '""',     'STRING',  'Platform',   'Public https address of this installation, no trailing slash (e.g. https://cep.example.com). The webhook callback addresses given to delivery providers, the unsubscribe link in marketing emails and the single sign-on redirect are built from it. Empty = the API_PUBLIC_URL environment variable.')
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
    v_secret  TEXT[] := ARRAY['password_hash', 'key_hash', 'client_secret_enc', 'mfa_secret_enc', 'mfa_recovery_hashes', 'password_enc', 'secret_enc', 'transactional_secret_enc'];
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
--    (tenant_id NULL, back-office -> Configuration -> Mail server). The platform row carries the platform's own mail and
--    the fallback for a tenant without a server; it is never a tenant's sending engine (patch 0027 removed the sharing
--    columns). Passwords are encrypted by the application
--    (FIELD_ENCRYPTION_KEY) and never enter the audit trail. Row-level security hides the platform row from the
--    API role (NULL never equals the current tenant).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_server (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID REFERENCES tenant(id),                      -- NULL: the platform's own server
    host                VARCHAR(253) NOT NULL,
    port                INTEGER NOT NULL DEFAULT 587,
    security            VARCHAR(10) NOT NULL DEFAULT 'STARTTLS',         -- NONE, STARTTLS (587), SSL (465)
    username            VARCHAR(200),
    password_enc        TEXT,
    from_email          CITEXT NOT NULL,
    from_name           VARCHAR(150),
    reply_to            CITEXT,
    campaign_sender     BOOLEAN NOT NULL DEFAULT FALSE,                  -- tenant row: also offered as a campaign delivery provider + sender profile
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
    CONSTRAINT ck_mail_server_host CHECK (host <> '')
);
ALTER TABLE mail_server ADD COLUMN IF NOT EXISTS campaign_sender BOOLEAN NOT NULL DEFAULT FALSE;
-- patch 0027: the platform's server is no longer shared with tenants. A tenant row that sent through it is removed
-- (the tenant enters its own server), and its campaign sender is retired with it.
DO $$ BEGIN                                            -- only while the column is still there: the layer re-runs on a patched database
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mail_server' AND column_name = 'use_platform_server') THEN
    UPDATE sender_profile SET deleted_at = now(), is_default = FALSE
     WHERE deleted_at IS NULL AND delivery_provider_id IN (
           SELECT dp.id FROM delivery_provider dp JOIN mail_server ms ON ms.id::text = dp.config->>'mail_server_id'
            WHERE dp.provider_type = 'SMTP' AND ms.use_platform_server);
    UPDATE delivery_provider SET deleted_at = now(), is_default = FALSE, is_active = FALSE
     WHERE deleted_at IS NULL AND provider_type = 'SMTP'
       AND config->>'mail_server_id' IN (SELECT id::text FROM mail_server WHERE use_platform_server);
    DELETE FROM mail_server WHERE use_platform_server;
  END IF;
END $$;
ALTER TABLE mail_server DROP CONSTRAINT IF EXISTS ck_mail_server_platform_row;
ALTER TABLE mail_server DROP CONSTRAINT IF EXISTS ck_mail_server_host;
ALTER TABLE mail_server DROP COLUMN IF EXISTS use_platform_server, DROP COLUMN IF EXISTS shared_with_all, DROP COLUMN IF EXISTS shared_tenant_ids;
ALTER TABLE mail_server ALTER COLUMN host DROP DEFAULT;
ALTER TABLE mail_server ADD CONSTRAINT ck_mail_server_host CHECK (host <> '');
CREATE UNIQUE INDEX IF NOT EXISTS ux_mail_server_tenant ON mail_server(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mail_server_platform ON mail_server((tenant_id IS NULL)) WHERE tenant_id IS NULL;
COMMENT ON TABLE mail_server IS 'SMTP servers entered in the product: one per tenant, plus the platform''s own (tenant_id NULL) for the platform''s own mail';

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

-- a tenant's mail server can be a campaign delivery provider: delivery_provider.provider_type = 'SMTP',
-- config = {"mail_server_id": ...}; the credentials stay in mail_server (encrypted), never in secret_ref
ALTER TABLE delivery_provider DROP CONSTRAINT IF EXISTS ck_delivery_provider_provider_type;
ALTER TABLE delivery_provider ADD CONSTRAINT ck_delivery_provider_provider_type CHECK (provider_type IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS', 'SMTP'));

-- -------------------------------------------------------------------------------------
-- 9. CAMPAIGN SEND ENGINE AND DELIVERY PROVIDER ADAPTERS
--    Providers are adapters behind one interface (backend/apps/delivery/providers). Credentials entered in the
--    product are encrypted by the application into secret_enc; secret_ref stays for credentials kept outside the
--    database (env:NAME, vault:path). Neither ever enters the audit trail.
-- -------------------------------------------------------------------------------------
ALTER TABLE delivery_provider ADD COLUMN IF NOT EXISTS secret_enc TEXT;
ALTER TABLE delivery_provider ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;
ALTER TABLE delivery_provider ADD COLUMN IF NOT EXISTS last_check_ok BOOLEAN;
ALTER TABLE delivery_provider ADD COLUMN IF NOT EXISTS last_check_error TEXT;
COMMENT ON COLUMN delivery_provider.secret_enc IS 'API key / password entered in the product, encrypted with FIELD_ENCRYPTION_KEY; wins over secret_ref';
-- patch 0020: one engine, two credentials. Transactional traffic (receipts, non-marketing campaigns) is sent with this
-- key when it is set: for Postal the API key of a second mail server, so receipts never queue behind a campaign and each
-- server keeps its own reputation. NULL = the one key carries everything.
ALTER TABLE delivery_provider ADD COLUMN IF NOT EXISTS transactional_secret_enc TEXT;
COMMENT ON COLUMN delivery_provider.transactional_secret_enc IS 'Credential for transactional traffic (receipts, non-marketing campaigns), encrypted like secret_enc; NULL = secret_enc carries everything';

ALTER TABLE delivery_provider DROP CONSTRAINT IF EXISTS ck_delivery_provider_provider_type;
ALTER TABLE delivery_provider ADD CONSTRAINT ck_delivery_provider_provider_type
    CHECK (provider_type IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS', 'SMTP', 'SENDGRID'));
ALTER TABLE delivery_webhook_event DROP CONSTRAINT IF EXISTS ck_delivery_webhook_event_provider;
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_provider
    CHECK (provider IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS', 'SMTP', 'SENDGRID'));

-- why a list member was left out of a run (NO_EMAIL, NO_CONSENT, UNSUBSCRIBED, BLOCKED_ADDRESS, FREQUENCY_CAP, DUPLICATE_ADDRESS ...)
ALTER TABLE campaign_list_member ADD COLUMN IF NOT EXISTS suppression_reason VARCHAR(40);
-- which provider carried the message: webhooks and reports join on it
ALTER TABLE mailer_execution ADD COLUMN IF NOT EXISTS delivery_provider_id UUID;
ALTER TABLE mailer_execution ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_mailer_execution_provider_message ON mailer_execution(tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
-- patch 0021: the provider's own id of a callback (Postal: the webhook request's uuid). Postal retries a callback on anything but a 2xx, so
-- the same event can arrive twice; the second arrival is kept as a DUPLICATE row for the audit trail and never applied, so an open or a
-- click is counted once. Not a unique index: the table is partitioned by tenant and month, and a unique index would have to carry the
-- month; the endpoint checks under an advisory lock instead.
ALTER TABLE delivery_webhook_event ADD COLUMN IF NOT EXISTS provider_event_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS ix_webhook_event_provider_event ON delivery_webhook_event(tenant_id, provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
ALTER TABLE delivery_webhook_event DROP CONSTRAINT IF EXISTS ck_delivery_webhook_event_processing_status;
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_processing_status CHECK (processing_status IN ('PENDING', 'PROCESSED', 'FAILED', 'DUPLICATE'));
COMMENT ON COLUMN delivery_webhook_event.provider_event_id IS 'The provider''s own id of the event (Postal: the webhook uuid); a second arrival is stored as DUPLICATE and not applied';

-- -------------------------------------------------------------------------------------
-- 10. SMS / MMS SENDING
--     Same engine and adapter contract as email (backend/apps/delivery). SANDBOX_SMS is an engine that accepts
--     messages and sends nothing: for trying a workspace's text flows before a real aggregator is connected.
-- -------------------------------------------------------------------------------------
ALTER TABLE sms_execution ADD COLUMN IF NOT EXISTS delivery_provider_id UUID;
ALTER TABLE sms_execution ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_sms_execution_provider_message ON sms_execution(tenant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sms_execution_phone ON sms_execution(tenant_id, phone_number, created_at DESC);

ALTER TABLE delivery_provider DROP CONSTRAINT IF EXISTS ck_delivery_provider_provider_type;
ALTER TABLE delivery_provider ADD CONSTRAINT ck_delivery_provider_provider_type
    CHECK (provider_type IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS', 'SMTP', 'SENDGRID', 'SANDBOX_SMS'));
ALTER TABLE delivery_webhook_event DROP CONSTRAINT IF EXISTS ck_delivery_webhook_event_provider;
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_provider
    CHECK (provider IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS', 'SMTP', 'SENDGRID', 'SANDBOX_SMS'));

-- What people text back: STOP / START / HELP keywords and free replies. Kept as received; `action` is what the platform did.
CREATE TABLE IF NOT EXISTS sms_inbound_message (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    provider            VARCHAR(20) NOT NULL,
    from_number         VARCHAR(30) NOT NULL,                            -- the person
    to_number           VARCHAR(30),                                     -- the workspace's short code / long number
    body                TEXT NOT NULL DEFAULT '',
    keyword             VARCHAR(20),                                     -- first word, upper-cased, when it is a known keyword
    action              VARCHAR(20) NOT NULL DEFAULT 'NONE',             -- OPT_OUT, OPT_IN, HELP, NONE
    party_id            VARCHAR(60),                                     -- resolved from the number, when known
    sms_execution_id    BIGINT,                                          -- the last message sent to that number (what they replied to)
    campaign_id         UUID,
    provider_message_id VARCHAR(200),
    raw_payload         JSONB NOT NULL DEFAULT '{}',
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_sms_inbound_action CHECK (action IN ('OPT_OUT', 'OPT_IN', 'HELP', 'NONE'))
);
CREATE INDEX IF NOT EXISTS ix_sms_inbound_tenant_received ON sms_inbound_message(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ix_sms_inbound_number ON sms_inbound_message(tenant_id, from_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sms_inbound_provider_message ON sms_inbound_message(tenant_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
COMMENT ON TABLE sms_inbound_message IS 'Text messages received from people: STOP / START / HELP keywords and free replies, with what the platform did';
ALTER TABLE sms_inbound_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_inbound_message FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sms_inbound_message_tenant ON sms_inbound_message;
CREATE POLICY rls_sms_inbound_message_tenant ON sms_inbound_message
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT ON sms_inbound_message TO cep_app;
GRANT ALL ON sms_inbound_message TO cep_admin;

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('messaging.sms_quiet_hours', '{"start": "21:00", "end": "08:00"}', 'OBJECT', 'Messaging',
     'Marketing texts are not started between these times (workspace time zone); a run that is due waits for the window to open. {} switches it off')
ON CONFLICT (key) DO NOTHING;

-- 11. CONTACT LIST MODULE
--     Three ways to make a list: upload a file (staged, mapped, reviewed, then applied), take an audience the data team
--     defined (a C360 segment), or clone a list (a snapshot with its parent recorded). A list made by the upload wizard is
--     a DRAFT until its first import is applied, so a half-finished upload never shows up in a campaign's list picker.
-- -------------------------------------------------------------------------------------
ALTER TABLE contact_list DROP CONSTRAINT IF EXISTS ck_contact_list_source_type;
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_source_type
    CHECK (source_type IN ('BI', 'EXTRACTION', 'UPLOAD', 'SEGMENT', 'CLONE'));
ALTER TABLE contact_list DROP CONSTRAINT IF EXISTS ck_contact_list_status;
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_status CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));
CREATE INDEX IF NOT EXISTS ix_contact_list_tenant_updated ON contact_list(tenant_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE contact_list_member DROP CONSTRAINT IF EXISTS ck_contact_list_member_membership_source;
ALTER TABLE contact_list_member ADD CONSTRAINT ck_contact_list_member_membership_source
    CHECK (membership_source IN ('UPLOAD', 'RULE', 'SEGMENT', 'MANUAL', 'CLONE'));
CREATE INDEX IF NOT EXISTS ix_contact_list_member_added ON contact_list_member(tenant_id, contact_list_id, added_at DESC);

-- The file as the operator sees it (headers, a few sample values, the property guessed for each column), what they mapped,
-- and the outcome of the review: matched_count = people already known, unmatched_count = new people,
-- duplicate_count = repeated in the file, rejected_count = cannot be imported, warning_count = imported with a remark.
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS file_columns JSONB NOT NULL DEFAULT '[]';
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS column_mapping JSONB NOT NULL DEFAULT '{}';
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS rejected_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS warning_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS error VARCHAR(500);
ALTER TABLE contact_list_import DROP CONSTRAINT IF EXISTS ck_contact_list_import_mapping_object;
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_mapping_object CHECK (jsonb_typeof(column_mapping) = 'object');

-- error_message says why a row is held back; warning is a remark on a row that IS imported (a phone number that was dropped, ...)
ALTER TABLE contact_list_import_row ADD COLUMN IF NOT EXISTS warning VARCHAR(300);
CREATE INDEX IF NOT EXISTS ix_contact_list_import_row_import ON contact_list_import_row(tenant_id, import_id, match_status);

-- 12. LIST UPLOADS AS BACKGROUND JOBS
--     A large file must not be read, checked and imported inside a web request. The request only stores the file and
--     samples its header; contact_list_import is the queue (the database is the queue, as for campaign runs: nothing is
--     lost when no broker is reachable). A worker claims one import at a time with FOR UPDATE SKIP LOCKED, never two of
--     the same workspace at once, and at most lists.import_max_parallel in the whole platform; it works in chunks, each
--     in its own short transaction, and reports progress. A worker that stops is noticed by its heartbeat.
--       UPLOADED  file stored, waiting to be read        STAGING   being read into contact_list_import_row
--       STAGED    read; waiting for the column mapping    MATCHING  being checked against the mapping
--       REVIEW    checked; waiting for the operator       APPLYING  being added to the list
--       APPLIED / FAILED / CANCELLED
-- -------------------------------------------------------------------------------------
ALTER TABLE contact_list_import DROP CONSTRAINT IF EXISTS ck_contact_list_import_status;
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_status
    CHECK (status IN ('UPLOADED', 'STAGING', 'STAGED', 'MATCHING', 'REVIEW', 'APPLYING', 'APPLIED', 'FAILED', 'CANCELLED'));
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS next_action VARCHAR(10);          -- what a worker should do next: STAGE, REVIEW, APPLY; NULL = nothing queued
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS mapping_confirmed BOOLEAN NOT NULL DEFAULT FALSE;  -- the operator confirmed the mapping (possibly while the file was still being read)
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS apply_when_ready BOOLEAN NOT NULL DEFAULT FALSE;   -- reserved: import without stopping at the review
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS progress_done BIGINT NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS progress_total BIGINT NOT NULL DEFAULT 0;         -- bytes while reading, rows afterwards
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS worker VARCHAR(120);
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS new_customer_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS consent_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS file_encoding VARCHAR(20);
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS file_delimiter VARCHAR(4);
ALTER TABLE contact_list_import DROP CONSTRAINT IF EXISTS ck_contact_list_import_next_action;
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_next_action CHECK (next_action IN ('STAGE', 'REVIEW', 'APPLY'));
CREATE INDEX IF NOT EXISTS ix_contact_list_import_queue ON contact_list_import(queued_at) WHERE next_action IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_contact_list_import_tenant_recent ON contact_list_import(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_list_import_row_line ON contact_list_import_row(tenant_id, import_id, row_number);

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('lists.import_max_parallel', '2', 'INTEGER', 'Contact lists',
     'How many list uploads the platform processes at the same time, all workspaces together. One workspace never has two running at once'),
    ('lists.import_max_waiting_per_workspace', '5', 'INTEGER', 'Contact lists',
     'A workspace with this many uploads in progress has to wait for one to finish before starting another'),
    ('lists.import_chunk_rows', '5000', 'INTEGER', 'Contact lists',
     'Rows per transaction while a file is read, checked and imported. Smaller = gentler on the database, slower overall')
ON CONFLICT (key) DO NOTHING;

-- 13. GOVERNANCE CHECK ON LIST UPLOADS
--     Every row that can be imported is judged the way a marketing email send would judge it today, in the same order
--     (backend/apps/delivery/engine/audience.py): blocked address (hard bounce, repeated soft bounces, complaint, other),
--     invalid address, suppressed, unsubscribed, no consent, otherwise marketable. The verdict is kept per row, and the
--     import carries a summary whose numbers add up: rows = held back + ready; ready = the governance buckets;
--     ready = added to the list + already in it. Staged rows are kept after the import: they are the row-by-row report.
-- -------------------------------------------------------------------------------------
ALTER TABLE contact_list_import_row ADD COLUMN IF NOT EXISTS governance_status VARCHAR(30);
ALTER TABLE contact_list_import_row DROP CONSTRAINT IF EXISTS ck_contact_list_import_row_governance;
ALTER TABLE contact_list_import_row ADD CONSTRAINT ck_contact_list_import_row_governance
    CHECK (governance_status IN ('MARKETABLE', 'UNSUBSCRIBED', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'COMPLAINT', 'BLOCKED', 'INVALID_ADDRESS', 'SUPPRESSED', 'NO_CONSENT'));
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}';
ALTER TABLE contact_list_import DROP CONSTRAINT IF EXISTS ck_contact_list_import_summary_object;
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_summary_object CHECK (jsonb_typeof(summary) = 'object');

-- 14. CAMPAIGN MODULE (BRD v0.9 sections 6.3, 7, 15)
--     The campaign, run, run-variant, campaign-list, target and actual tables already carry the execution model (a Run
--     beneath a Campaign, subject-line variants per Run for Phase II, a frozen de-duplicated Campaign List). This section
--     adds what planning and operating a campaign needs on top of it.
--       Status   the locked vocabulary stays (DRAFT, TEST_PUBLISHED, PRODUCTION_PUBLISHED, ACTIVE, COMPLETED, CANCELLED);
--                PAUSED and ARCHIVED are added. "Scheduled" is not a stored status: it is a production-published
--                campaign whose next run lies in the future. Archive replaces delete; previous_status is where
--                resume goes back to.
--       Send     IMMEDIATE | SCHEDULED | RECURRING (recurring_config) | DRIP (drip_config). A recurring or drip campaign
--                is one Campaign with several Runs, never several campaigns.
--       Lists    a list is attached to INCLUDE its people or to EXCLUDE them (a suppression list for this campaign).
--       Log      campaign_activity_log: what happened to a campaign, in words, for the people who run it. The
--                definition audit trail (triggers) stays the record of who changed which column.
-- -------------------------------------------------------------------------------------
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_status;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_status
    CHECK (status IN ('DRAFT', 'TEST_PUBLISHED', 'PRODUCTION_PUBLISHED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'ARCHIVED'));
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS previous_status VARCHAR(30);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS send_type VARCHAR(20) NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS send_timezone VARCHAR(64);                       -- the zone the schedule was entered in; NULL = the workspace's
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS recurring_config JSONB;                          -- {frequency: DAILY|WEEKLY|MONTHLY, interval, weekdays[], day_of_month, time, end_date, max_runs}
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS drip_config JSONB;                               -- {steps: [{day: 0, template?: uuid}, {day: 3}, ...], time}
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS respect_governance BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS rate_limit_per_hour INTEGER;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS timezone_optimization BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS receipt_config JSONB;                            -- e-receipt: layout and field visibility, where the template does not define it
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_send_type;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_send_type CHECK (send_type IN ('IMMEDIATE', 'SCHEDULED', 'RECURRING', 'DRIP'));
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_tags_array;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_tags_array CHECK (jsonb_typeof(tags) = 'array');
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_rate_limit;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_rate_limit CHECK (rate_limit_per_hour IS NULL OR rate_limit_per_hour > 0);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_name_live ON campaign(tenant_id, lower(name)) WHERE deleted_at IS NULL AND status <> 'ARCHIVED' AND NOT is_journey_generated;
CREATE INDEX IF NOT EXISTS ix_campaign_tenant_status_created ON campaign(tenant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_tags ON campaign USING GIN (tags);

ALTER TABLE campaign_run DROP CONSTRAINT IF EXISTS ck_campaign_run_status;
ALTER TABLE campaign_run ADD CONSTRAINT ck_campaign_run_status
    CHECK (status IN ('SCHEDULED', 'PREPARING', 'SENDING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE campaign_run ADD COLUMN IF NOT EXISTS sequence_label VARCHAR(60);                  -- "Day 3", "Week 2": the step of a drip, the occurrence of a recurrence

ALTER TABLE contact_list_campaign ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'INCLUDE';
ALTER TABLE contact_list_campaign DROP CONSTRAINT IF EXISTS ck_contact_list_campaign_role;
ALTER TABLE contact_list_campaign ADD CONSTRAINT ck_contact_list_campaign_role CHECK (role IN ('INCLUDE', 'EXCLUDE'));

ALTER TABLE campaign_target ADD COLUMN IF NOT EXISTS planned_offer_cost NUMERIC(14,2);         -- offer / coupon / incentive cost (BRD 15)
ALTER TABLE campaign_target ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS campaign_activity_log (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    campaign_run_id     UUID,
    event_type          VARCHAR(30) NOT NULL,             -- CREATED, MODIFIED, LIST_ATTACHED, LIST_DETACHED, TEST_PUBLISHED, PUBLISHED, SCHEDULE_CANCELLED,
                                                          -- SEND_STARTED, SEND_COMPLETED, SEND_FAILED, PAUSED, RESUMED, CLONED, ARCHIVED, UNARCHIVED, WARNING
    severity            VARCHAR(10) NOT NULL DEFAULT 'INFO',
    message             VARCHAR(500) NOT NULL,
    detail              JSONB NOT NULL DEFAULT '{}',
    actor_user_id       UUID,
    actor_name          VARCHAR(200),                     -- kept as text: the log still reads right after a user is removed
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_campaign_activity_severity CHECK (severity IN ('INFO', 'WARNING', 'ERROR'))
);
CREATE INDEX IF NOT EXISTS ix_campaign_activity_campaign ON campaign_activity_log(tenant_id, campaign_id, occurred_at DESC);
COMMENT ON TABLE campaign_activity_log IS 'What happened to a campaign, in words: created, published, send started, paused ... (the definition audit trail stays the column-level record)';
ALTER TABLE campaign_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_activity_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_campaign_activity_log_tenant ON campaign_activity_log;
CREATE POLICY rls_campaign_activity_log_tenant ON campaign_activity_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT ON campaign_activity_log TO cep_app;
GRANT ALL ON campaign_activity_log TO cep_admin;

-- 15. CAMPAIGN SETUP PROGRESS
--     How many of the setup's steps were completed (Basic Info, Audience, Template, Scheduling & Delivery, Targets &
--     Economics, Test & Preview = 6; the seventh step is the publish itself). An unfinished draft opens in the setup at
--     the step it stopped at, not on the campaign page. It cannot be told from the data: schedule, targets and test are
--     all optional. The default is 6: campaigns that existed before, and the ones an integration creates, are complete.
-- -------------------------------------------------------------------------------------
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS setup_step SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_setup_step;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_setup_step CHECK (setup_step BETWEEN 0 AND 6);

-- -------------------------------------------------------------------------------------
-- 16. CAMPAIGN RESULTS: (tenant_id, campaign_id) INDEX
--     campaigns.service.metrics()/timeseries() (the results tab and dashboard) filter mailer_execution/sms_execution by
--     campaign, not by campaign_run: the existing (campaign_run_id, status) index does not serve that filter, so every
--     call scanned the tenant's whole monthly partition. Declared on the partitioned parent, so PostgreSQL adds it to
--     every existing and future per-tenant/per-month partition automatically.
-- -------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_mailer_execution_campaign ON mailer_execution(tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS ix_sms_execution_campaign ON sms_execution(tenant_id, campaign_id);

-- -------------------------------------------------------------------------------------
-- 17. INTEGRATION BRIDGE
--     Every call CEP makes to an outside system (Postal, SendGrid, Digivize, a mail server) and every call an outside
--     system makes to CEP (a point of sale sending a receipt, a provider reporting a delivery) is throttled, logged and
--     measured per workspace. `integration` is the record an operator manages; `integration_log` is one row per call in
--     either direction; `integration_metric` is what the status pages read, so the log is never scanned for a chart.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    kind                VARCHAR(30) NOT NULL,                            -- POS_RECEIPTS (inbound), PROVIDER (one per sending engine)
    name                VARCHAR(100) NOT NULL,
    direction           VARCHAR(3) NOT NULL,                             -- IN, OUT
    system              VARCHAR(30) NOT NULL,                            -- POS, POSTAL, SENDGRID, SMTP, DIGIVIZE, SANDBOX_SMS
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',           -- ACTIVE, PAUSED (paused: inbound answers 503, outbound waits)
    environment         VARCHAR(10) NOT NULL DEFAULT 'PRODUCTION',       -- SANDBOX, PRODUCTION
    delivery_provider_id UUID REFERENCES delivery_provider(id),          -- PROVIDER kind: the engine this record guards
    throttle_per_minute INTEGER,                                         -- NULL = the plan's default (inbound) / the engine's own rate (outbound)
    throttle_burst      INTEGER,                                         -- calls one second may carry above the even pace
    retry_max_attempts  INTEGER NOT NULL DEFAULT 3,
    breaker_failures    INTEGER NOT NULL DEFAULT 5,                      -- consecutive failures that open the circuit
    breaker_cooldown_seconds INTEGER NOT NULL DEFAULT 60,
    breaker_open_until  TIMESTAMPTZ,                                     -- mirrored from the cache for the status page
    log_level           VARCHAR(10) NOT NULL DEFAULT 'FULL',             -- FULL, ERRORS (bodies for failures only), NONE
    log_body_max_bytes  INTEGER NOT NULL DEFAULT 65536,
    log_retention_days  INTEGER NOT NULL DEFAULT 90,
    last_call_at        TIMESTAMPTZ,
    last_outcome        VARCHAR(12),
    last_error          VARCHAR(500),
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_integration_kind CHECK (kind IN ('POS_RECEIPTS', 'PROVIDER', 'ORDERS', 'EVENTS', 'COUPONS')),
    CONSTRAINT ck_integration_direction CHECK (direction IN ('IN', 'OUT')),
    CONSTRAINT ck_integration_status CHECK (status IN ('ACTIVE', 'PAUSED')),
    CONSTRAINT ck_integration_environment CHECK (environment IN ('SANDBOX', 'PRODUCTION')),
    CONSTRAINT ck_integration_log_level CHECK (log_level IN ('FULL', 'ERRORS', 'NONE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_tenant_kind ON integration(tenant_id, kind) WHERE delivery_provider_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_provider ON integration(delivery_provider_id) WHERE delivery_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_integration_tenant ON integration(tenant_id);
COMMENT ON TABLE integration IS 'One record per external integration of a workspace: its throttle, retry, circuit-breaker and log policy, and its last call';

CREATE TABLE IF NOT EXISTS integration_log (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    integration_id      UUID,
    direction           VARCHAR(3) NOT NULL,                             -- IN, OUT
    kind                VARCHAR(30) NOT NULL,
    system              VARCHAR(30) NOT NULL,
    correlation_id      VARCHAR(64) NOT NULL,
    related_ref         VARCHAR(200),                                    -- mailer_execution:<id>, receipt:<number>, run:<id>, provider:<id>
    method              VARCHAR(10) NOT NULL,
    url                 TEXT NOT NULL,
    request_headers     JSONB,
    request_body        TEXT,
    request_bytes       INTEGER NOT NULL DEFAULT 0,
    response_status     INTEGER,
    response_headers    JSONB,
    response_body       TEXT,
    response_bytes      INTEGER NOT NULL DEFAULT 0,
    outcome             VARCHAR(12) NOT NULL,                            -- OK, REJECTED, RETRY, ERROR, THROTTLED, BREAKER, PAUSED
    error_class         VARCHAR(100),
    error_message       VARCHAR(500),
    attempt             INTEGER NOT NULL DEFAULT 1,
    duration_ms         INTEGER,
    api_client_id       UUID,
    worker              VARCHAR(200),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, started_at),
    CONSTRAINT ck_integration_log_outcome CHECK (outcome IN ('OK', 'REJECTED', 'RETRY', 'ERROR', 'THROTTLED', 'BREAKER', 'PAUSED'))
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (started_at) monthly) are created by fn_provision_tenant() -- see the SaaS tenancy layer.
CREATE INDEX IF NOT EXISTS ix_integration_log_recent ON integration_log(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_integration_log_integration ON integration_log(tenant_id, integration_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_integration_log_correlation ON integration_log(tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS ix_integration_log_ref ON integration_log(tenant_id, related_ref);
COMMENT ON TABLE integration_log IS 'One row per API call in either direction: what was sent, what came back, how long it took; credentials and card numbers never enter it';

CREATE TABLE IF NOT EXISTS integration_metric (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    integration_id      UUID NOT NULL REFERENCES integration(id),
    bucket_start        TIMESTAMPTZ NOT NULL,                            -- the minute
    calls               INTEGER NOT NULL DEFAULT 0,
    ok                  INTEGER NOT NULL DEFAULT 0,
    rejected            INTEGER NOT NULL DEFAULT 0,
    retried             INTEGER NOT NULL DEFAULT 0,
    errors              INTEGER NOT NULL DEFAULT 0,
    throttled           INTEGER NOT NULL DEFAULT 0,
    duration_p50_ms     INTEGER,
    duration_p95_ms     INTEGER,
    duration_max_ms     INTEGER,
    bytes_in            BIGINT NOT NULL DEFAULT 0,
    bytes_out           BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, integration_id, bucket_start)
);
CREATE INDEX IF NOT EXISTS ix_integration_metric_recent ON integration_metric(tenant_id, bucket_start DESC);
COMMENT ON TABLE integration_metric IS 'Per-minute figures per integration, rolled up from integration_log by the rollup-integration-metrics job';

INSERT INTO partition_retention_policy (table_name, sub_method, sub_key, hash_modulus, retention_months, expiry_action, note) VALUES
    ('integration_log', 'RANGE_MONTHLY', 'started_at', NULL, 3, 'DROP', 'Integration request/response log; 90 days, then dropped')
ON CONFLICT (table_name) DO NOTHING;

-- a tenant that existed before this table needs its partitions now; fn_provision_tenant skips what already exists
DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenant WHERE deleted_at IS NULL LOOP
        IF to_regclass(fn_tenant_partition_name('integration_log', t.id)) IS NULL THEN
            PERFORM fn_provision_tenant(t.id, 3);
        END IF;
    END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['integration'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_touch_row()', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_audit ON %I', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fn_definition_audit()', t, t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['integration', 'integration_log', 'integration_metric'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%s_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%s_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
-- the API creates a workspace's integration records and pauses or resumes them; policies are edited in the back-office
GRANT SELECT, INSERT, UPDATE ON integration TO cep_app;
GRANT SELECT, INSERT ON integration_log TO cep_app;                     -- written, never changed
GRANT SELECT, INSERT, UPDATE ON integration_metric TO cep_app;          -- the rollup job writes on whichever connection holds the log
GRANT ALL ON integration, integration_log, integration_metric TO cep_admin;

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('integrations.inbound_per_minute', '{"STARTER": 60, "GROWTH": 600, "ENTERPRISE": null, "default": 60}', 'OBJECT', 'Integrations',
     'Calls per minute a workspace''s systems may make to the API, by plan code (null = no limit); "default" applies to a workspace with no plan. A workspace''s own integration record overrides it.'),
    ('integrations.log_body_max_bytes', '65536', 'INTEGER', 'Integrations', 'Largest request or response body kept in the integration log; longer bodies keep their start and a digest'),
    ('integrations.log_retention_days', '90', 'INTEGER', 'Integrations', 'Days an integration log row is kept (the monthly partitions are dropped past this)'),
    ('integrations.metric_retention_months', '13', 'INTEGER', 'Integrations', 'Months of per-minute integration figures kept')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================================
-- CAMPAIGN APPROVAL (patch 0022): a workspace can require a second person before a production publish.
--   tenant.settings.approvals.require_approval switches it on. The author asks (REQUESTED), someone with the
--   campaign.approve permission approves (APPROVED) or sends it back (RETURNED); a change to the campaign after
--   that withdraws the approval (NULL). The publish endpoint refuses a required approval that is not APPROVED.
-- =====================================================================================
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20);                  -- NULL none | REQUESTED | APPROVED | RETURNED
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_requested_by UUID REFERENCES app_user(id);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_note TEXT;                            -- the author's note to the approver
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_decided_by UUID REFERENCES app_user(id);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_decided_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS approval_decision_note TEXT;                   -- why it was sent back, or a word on approval
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_approval_status;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_approval_status CHECK (approval_status IS NULL OR approval_status IN ('REQUESTED', 'APPROVED', 'RETURNED'));
CREATE INDEX IF NOT EXISTS ix_campaign_awaiting_approval ON campaign(tenant_id, approval_requested_at DESC) WHERE approval_status = 'REQUESTED' AND deleted_at IS NULL;

INSERT INTO permission (id, code, description) VALUES ('a3000000-0000-4000-8000-000000000017', 'campaign.approve', 'Campaign approve')
ON CONFLICT (code) DO NOTHING;
-- every role that administers users may approve, so no workspace is left without an approver
INSERT INTO role_permission (role_id, permission_id)
    SELECT rp.role_id, approve.id FROM role_permission rp
    JOIN permission admin ON admin.id = rp.permission_id AND admin.code = 'user.admin'
    JOIN permission approve ON approve.code = 'campaign.approve'
ON CONFLICT DO NOTHING;

-- =====================================================================================
-- A/B SUBJECT LINES AND SEND-TIME OPTIMISATION (patch 0023)
--   campaign.ab_config: {enabled, subject_b, sample_pct, metric OPEN_RATE|CLICK_RATE, decide_after_minutes}. At the send a sample of the
--   audience gets subject A or B (mailer_execution.variant_key), the rest waits as HOLD; the decide-ab-winners job picks the winner
--   at campaign_run.ab_decide_at (campaign_run_variant carries the figures) and releases the rest with the winning subject.
--   campaign.timezone_optimization: each message carries send_after, the scheduled wall-clock time in the recipient's own zone
--   (custom_attributes.timezone, else the address's state or country); the engine claims nothing before its send_after.
-- =====================================================================================
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS ab_config JSONB;
ALTER TABLE campaign_run ADD COLUMN IF NOT EXISTS ab_decide_at TIMESTAMPTZ;                  -- NULL: no subject test on this run
ALTER TABLE mailer_execution ADD COLUMN IF NOT EXISTS variant_key VARCHAR(20);              -- A | B | HOLD; NULL = no test
ALTER TABLE mailer_execution ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ;               -- not before this moment; NULL = as soon as the run sends
ALTER TABLE sms_execution ADD COLUMN IF NOT EXISTS send_after TIMESTAMPTZ;
ALTER TABLE campaign DROP CONSTRAINT IF EXISTS ck_campaign_ab_config_object;
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_ab_config_object CHECK (ab_config IS NULL OR jsonb_typeof(ab_config) = 'object');

-- =====================================================================================
-- A CAMPAIGN'S OWN SUBJECT LINE AND PREHEADER (patch 0025)
--   campaign.subject_line / campaign.preheader: set on the setup's Content step to replace the template's for this campaign
--   only. NULL = the template's. Email only: a text has neither. The send puts the preheader (this one, else the template's)
--   at the top of the HTML part as hidden inbox preview text.
-- =====================================================================================
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS subject_line VARCHAR(300);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS preheader VARCHAR(300);

-- =====================================================================================
-- PLATFORM PERSONALIZATION TAGS (patch 0026)
--   One catalogue for the installation, kept in the back-office (Configuration -> Personalization tags), inherited by every
--   workspace: each active platform tag is copied into the workspace's personalization_tag, linked by platform_tag_id, at
--   onboarding and whenever the platform tag is saved. A copy is the platform's to change (the workspace API refuses);
--   a tag the workspace made itself with the same key is left alone. Deleting a platform tag releases its copies
--   (platform_tag_id -> NULL): they become the workspace's own.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS platform_personalization_tag (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_key             VARCHAR(100) NOT NULL UNIQUE,                    -- the word inside {{ }}
    label               VARCHAR(150) NOT NULL,
    tag_kind            VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
    source_system       VARCHAR(40) NOT NULL DEFAULT 'CEP',
    resolution_source   VARCHAR(30) NOT NULL,                            -- where the value comes from (apps/templates/datapoints.py)
    source_path         VARCHAR(200),                                    -- the data point within it
    static_value        TEXT,
    default_value       TEXT,
    format_spec         VARCHAR(60),
    data_type           VARCHAR(20) NOT NULL DEFAULT 'STRING',
    applies_to_channels TEXT[] NOT NULL DEFAULT '{EMAIL,E_RECEIPT,SMS,MMS}',
    description         TEXT,
    sample_value        TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,                   -- fn_touch_row bumps it, as on every definition table
    CONSTRAINT ck_platform_personalization_tag_key CHECK (tag_key ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ck_platform_personalization_tag_kind CHECK (tag_kind IN ('STANDARD', 'CUSTOM', 'SYSTEM')),
    CONSTRAINT ck_platform_personalization_tag_source CHECK (resolution_source IN ('CUSTOMER_MASTER', 'CAMPAIGN_LIST_MEMBER', 'CAMPAIGN', 'CAMPAIGN_RUN', 'STORE', 'SYSTEM', 'STATIC', 'RECEIPT')),
    CONSTRAINT ck_platform_personalization_tag_data_type CHECK (data_type IN ('STRING', 'NUMBER', 'DATE', 'BOOLEAN'))
);
COMMENT ON TABLE platform_personalization_tag IS 'The installation''s tag catalogue, inherited by every workspace (personalization_tag.platform_tag_id).';
ALTER TABLE platform_personalization_tag ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
DROP TRIGGER IF EXISTS trg_platform_personalization_tag_touch ON platform_personalization_tag;
CREATE TRIGGER trg_platform_personalization_tag_touch BEFORE UPDATE ON platform_personalization_tag FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
ALTER TABLE personalization_tag ADD COLUMN IF NOT EXISTS platform_tag_id UUID REFERENCES platform_personalization_tag(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_personalization_tag_platform ON personalization_tag(platform_tag_id) WHERE platform_tag_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_personalization_tag TO cep_app;             -- written by the back-office only, as mail_server is
GRANT ALL ON platform_personalization_tag TO cep_admin;

-- the standard catalogue every installation starts with; a workspace that already has a tag with one of these keys keeps its own
INSERT INTO platform_personalization_tag (tag_key, label, tag_kind, resolution_source, source_path, data_type, applies_to_channels, description, sample_value) VALUES
    ('first_name', 'First Name', 'STANDARD', 'CUSTOMER_MASTER', 'first_name', 'STRING', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The person''s first name from the customer record', 'Jordan'),
    ('last_name', 'Last Name', 'STANDARD', 'CUSTOMER_MASTER', 'last_name', 'STRING', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The person''s last name from the customer record', 'Lee'),
    ('coupon_code', 'Coupon Code', 'CUSTOM', 'CAMPAIGN_LIST_MEMBER', 'custom_value_pairs.coupon_code', 'STRING', '{EMAIL,E_RECEIPT,SMS,MMS}', 'A coupon code carried on the list upload', 'SAVE20-7K3Q'),
    ('coupon_barcode_value', 'Coupon Barcode Value', 'CUSTOM', 'CAMPAIGN_LIST_MEMBER', 'custom_value_pairs.coupon_barcode_value', 'STRING', '{EMAIL,E_RECEIPT}', 'The value a barcode block draws', 'CPN400012345678'),
    ('coupon_qr_value', 'Coupon QR Value', 'CUSTOM', 'CAMPAIGN_LIST_MEMBER', 'custom_value_pairs.coupon_qr_value', 'STRING', '{EMAIL,E_RECEIPT}', 'The value a QR code block draws', 'https://shop.example.com/c/SAVE20-7K3Q'),
    ('unsubscribe_url', 'Unsubscribe Link', 'SYSTEM', 'SYSTEM', 'unsubscribe_url', 'STRING', '{EMAIL}', 'The recipient''s own unsubscribe link, made at send time', 'https://cep.example.com/unsubscribe'),
    ('current_year', 'Current Year', 'SYSTEM', 'SYSTEM', 'current_year', 'STRING', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The year of the send', '2026'),
    ('today', 'Today''s Date', 'SYSTEM', 'SYSTEM', 'today', 'DATE', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The date of the send', '2026-09-29'),
    ('campaign_name', 'Campaign Name', 'SYSTEM', 'SYSTEM', 'campaign_name', 'STRING', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The name of the campaign being sent', 'Fall Launch')
ON CONFLICT (tag_key) DO NOTHING;

-- =====================================================================================
-- PREFERENCE CENTRE (patch 0028)
--   A workspace switches it on under Settings -> Preference Centre (tenant.settings.preference_center). subscription_topic
--   is what a person can choose to receive; party_topic_preference holds the choice (a row with opted_out = TRUE leaves
--   the person out of campaigns filed under that topic: campaign.topic_id, audience reason TOPIC_OPTED_OUT). Channel
--   choices made on the page are ordinary consent records with source PREFERENCE_CENTER. {{preference_url}} in a
--   template is the person's page, or the unsubscribe link while the centre is off.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS subscription_topic (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    code                VARCHAR(40) NOT NULL,                            -- stable key made from the name
    name                VARCHAR(80) NOT NULL,                            -- what the person sees
    description         VARCHAR(200),
    channels            TEXT[] NOT NULL DEFAULT '{EMAIL,SMS}',           -- where it is offered
    is_shown            BOOLEAN NOT NULL DEFAULT TRUE,                   -- on the page; hidden = kept for campaigns only
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_subscription_topic_code CHECK (code ~ '^[a-z][a-z0-9_]*$'),
    CONSTRAINT ck_subscription_topic_channels CHECK (channels <@ ARRAY['EMAIL', 'SMS']::text[] AND cardinality(channels) > 0),
    CONSTRAINT ux_subscription_topic_code UNIQUE (tenant_id, code)
);
COMMENT ON TABLE subscription_topic IS 'What a person can choose to receive on the preference page; a marketing campaign is filed under one';
CREATE TABLE IF NOT EXISTS party_topic_preference (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    topic_id            UUID NOT NULL REFERENCES subscription_topic(id),
    opted_out           BOOLEAN NOT NULL DEFAULT TRUE,
    evidence            JSONB,                                           -- ip, user agent, page
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, party_id, topic_id)
);
COMMENT ON TABLE party_topic_preference IS 'A person''s choice per topic: opted_out = TRUE keeps them out of campaigns filed under it';
CREATE INDEX IF NOT EXISTS ix_party_topic_preference_topic ON party_topic_preference(tenant_id, topic_id) WHERE opted_out;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES subscription_topic(id);   -- NULL: not filed under a topic
DROP TRIGGER IF EXISTS trg_subscription_topic_touch ON subscription_topic;
CREATE TRIGGER trg_subscription_topic_touch BEFORE UPDATE ON subscription_topic FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
DROP TRIGGER IF EXISTS trg_subscription_topic_audit ON subscription_topic;
CREATE TRIGGER trg_subscription_topic_audit AFTER INSERT OR UPDATE OR DELETE ON subscription_topic FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['subscription_topic', 'party_topic_preference'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_tenant ON %I', t, t);
    EXECUTE format('CREATE POLICY rls_%s_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                   'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
  END LOOP; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON subscription_topic, party_topic_preference TO cep_app;
GRANT ALL ON subscription_topic, party_topic_preference TO cep_admin;
INSERT INTO platform_personalization_tag (tag_key, label, tag_kind, resolution_source, source_path, data_type, applies_to_channels, description, sample_value) VALUES
    ('preference_url', 'Preference Centre Link', 'SYSTEM', 'SYSTEM', 'preference_url', 'STRING', '{EMAIL}',
     'The recipient''s own preference page, made at send time; the unsubscribe link while the workspace''s preference centre is off', 'https://cep.example.com/preferences')
ON CONFLICT (tag_key) DO NOTHING;

-- =====================================================================================
-- POINT OF SALE E-RECEIPTS (patch 0029)
--   The point of sale posts a TransactionTree TTDR 3.2.2 transaction to POST /api/v1/pos/transactions/ (workspace API key, scope
--   receipts:send); CEP validates it, renders the e-receipt and sends it, and keeps only the integration log row (what was
--   received, what was answered) and the receipt's mailer_execution. The transaction and the customer are never stored: they
--   belong to C360. `store` is the workspace's own list of its locations, because a transaction names a store by number only.
--   Tags read from the transaction come from a new resolution source, TRANSACTION.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS store (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    store_number        VARCHAR(40) NOT NULL,                            -- as the point of sale sends it (TransactionLocation/StoreNumber)
    name                VARCHAR(150) NOT NULL,
    brand               VARCHAR(150),
    address1            VARCHAR(200),
    address2            VARCHAR(200),
    city                VARCHAR(120),
    state               VARCHAR(60),
    postal_code         VARCHAR(20),
    country             VARCHAR(60),
    district            VARCHAR(120),
    phone               VARCHAR(40),
    email               VARCHAR(254),
    manager             VARCHAR(150),
    return_policy       TEXT,
    url1                VARCHAR(300),
    url2                VARCHAR(300),
    url3                VARCHAR(300),
    url4                VARCHAR(300),
    image_url           VARCHAR(300),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ux_store_number UNIQUE (tenant_id, store_number)
);
COMMENT ON TABLE store IS 'The workspace''s stores, by the number the point of sale sends; fills the STORE tags of an e-receipt';
DROP TRIGGER IF EXISTS trg_store_touch ON store;
CREATE TRIGGER trg_store_touch BEFORE UPDATE ON store FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
DROP TRIGGER IF EXISTS trg_store_audit ON store;
CREATE TRIGGER trg_store_audit AFTER INSERT OR UPDATE OR DELETE ON store FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
ALTER TABLE store ENABLE ROW LEVEL SECURITY;
ALTER TABLE store FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_store_tenant ON store;
CREATE POLICY rls_store_tenant ON store
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON store TO cep_app;
GRANT ALL ON store TO cep_admin;
ALTER TABLE personalization_tag DROP CONSTRAINT IF EXISTS ck_personalization_tag_resolution_source;
ALTER TABLE personalization_tag ADD CONSTRAINT ck_personalization_tag_resolution_source
    CHECK (resolution_source IN ('CUSTOMER_MASTER', 'CAMPAIGN_LIST_MEMBER', 'CAMPAIGN', 'CAMPAIGN_RUN', 'STORE', 'SYSTEM', 'STATIC', 'INNER_TEMPLATE', 'RECEIPT', 'TRANSACTION'));
ALTER TABLE platform_personalization_tag DROP CONSTRAINT IF EXISTS ck_platform_personalization_tag_source;
ALTER TABLE platform_personalization_tag ADD CONSTRAINT ck_platform_personalization_tag_source
    CHECK (resolution_source IN ('CUSTOMER_MASTER', 'CAMPAIGN_LIST_MEMBER', 'CAMPAIGN', 'CAMPAIGN_RUN', 'STORE', 'SYSTEM', 'STATIC', 'RECEIPT', 'TRANSACTION'));
-- the standard e-receipt tags a point-of-sale template uses, inherited by every workspace
INSERT INTO platform_personalization_tag (tag_key, label, tag_kind, resolution_source, source_path, data_type, applies_to_channels, description, sample_value) VALUES
    ('trans_id', 'Transaction ID', 'STANDARD', 'TRANSACTION', 'id', 'STRING', '{E_RECEIPT}', 'The point of sale''s transaction number', '243309'),
    ('trans_cat', 'Transaction Category', 'STANDARD', 'TRANSACTION', 'category', 'STRING', '{E_RECEIPT}', 'Sale, Return, Exchange, Void, Layaway', 'Sale'),
    ('trans_date', 'Transaction Date', 'STANDARD', 'TRANSACTION', 'date', 'DATE', '{E_RECEIPT}', 'The day of the transaction', '2026-09-23'),
    ('trans_time', 'Transaction Time', 'STANDARD', 'TRANSACTION', 'time', 'STRING', '{E_RECEIPT}', 'The time of the transaction', '18:07:18'),
    ('register_number', 'Register Number', 'STANDARD', 'TRANSACTION', 'register_number', 'STRING', '{E_RECEIPT}', 'The register the sale was rung on', '1'),
    ('terminal_id', 'Terminal ID', 'STANDARD', 'TRANSACTION', 'terminal_id', 'STRING', '{E_RECEIPT}', 'The payment terminal', '0000000000'),
    ('clerk_id', 'Clerk ID', 'STANDARD', 'TRANSACTION', 'clerk_id', 'STRING', '{E_RECEIPT}', 'The associate''s id', '4097067'),
    ('clerk_name', 'Clerk Name', 'STANDARD', 'TRANSACTION', 'clerk_name', 'STRING', '{E_RECEIPT}', 'The associate''s name', 'Jose'),
    ('item_count', 'Item Count', 'STANDARD', 'TRANSACTION', 'item_count', 'NUMBER', '{E_RECEIPT}', 'How many items were sold', '6'),
    ('bar_code', 'Receipt Barcode Value', 'STANDARD', 'TRANSACTION', 'barcode_value', 'STRING', '{E_RECEIPT}', 'The value the receipt barcode carries (a barcode block draws it)', '0080101243309092326'),
    ('layaway_number', 'Layaway Number', 'STANDARD', 'TRANSACTION', 'layaway_number', 'STRING', '{E_RECEIPT}', 'The layaway this transaction belongs to', ''),
    ('customer_id', 'Customer ID', 'STANDARD', 'TRANSACTION', 'customer.id', 'STRING', '{E_RECEIPT}', 'The customer id the point of sale sent', '20946472'),
    ('customer_fullname', 'Customer Full Name', 'STANDARD', 'TRANSACTION', 'customer.full_name', 'STRING', '{E_RECEIPT}', 'First and last name as the point of sale sent them', 'Jordan Lee'),
    ('email_address', 'Customer Email Address', 'STANDARD', 'TRANSACTION', 'customer.email', 'STRING', '{E_RECEIPT}', 'The address the receipt goes to', 'jordan@example.com'),
    ('phone', 'Customer Phone', 'STANDARD', 'TRANSACTION', 'customer.phone', 'STRING', '{E_RECEIPT}', 'The phone number the point of sale sent', '4249440599'),
    ('birthday', 'Customer Birthday', 'STANDARD', 'TRANSACTION', 'customer.birthday', 'STRING', '{E_RECEIPT}', 'From the transaction''s demographics, when sent', ''),
    ('full_address', 'Customer Full Address', 'STANDARD', 'TRANSACTION', 'customer.full_address', 'STRING', '{E_RECEIPT}', 'The customer''s address as the point of sale sent it', ''),
    ('loyalty_balance', 'Points Balance', 'STANDARD', 'TRANSACTION', 'loyalty.balance', 'NUMBER', '{E_RECEIPT}', 'The loyalty balance after this transaction', ''),
    ('loyalty_earned', 'Points Earned', 'STANDARD', 'TRANSACTION', 'loyalty.earned', 'NUMBER', '{E_RECEIPT}', 'Points earned on this transaction', ''),
    ('store_id', 'Store Number', 'STANDARD', 'STORE', 'id', 'STRING', '{E_RECEIPT}', 'The store number the point of sale sent', '801'),
    ('store_name', 'Store Name', 'STANDARD', 'STORE', 'name', 'STRING', '{E_RECEIPT}', 'From the workspace''s store list', 'Northwind Apparel Buckhead'),
    ('store_brand', 'Store Brand', 'STANDARD', 'STORE', 'brand', 'STRING', '{E_RECEIPT}', 'From the workspace''s store list', 'Northwind Apparel'),
    ('store_address', 'Store Address 1', 'STANDARD', 'STORE', 'address1', 'STRING', '{E_RECEIPT}', 'From the store list, or the transaction when it carries an address', '1200 Peachtree St NE'),
    ('store_address_2', 'Store Address 2', 'STANDARD', 'STORE', 'address2', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_city', 'Store City', 'STANDARD', 'STORE', 'city', 'STRING', '{E_RECEIPT}', 'From the store list', 'Atlanta'),
    ('store_state', 'Store State', 'STANDARD', 'STORE', 'state', 'STRING', '{E_RECEIPT}', 'From the store list', 'GA'),
    ('store_postal', 'Store Postal Code', 'STANDARD', 'STORE', 'postal_code', 'STRING', '{E_RECEIPT}', 'From the store list', '30309'),
    ('store_country', 'Store Country', 'STANDARD', 'STORE', 'country', 'STRING', '{E_RECEIPT}', 'From the store list', 'US'),
    ('store_district', 'Store District', 'STANDARD', 'STORE', 'district', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_phone', 'Store Phone', 'STANDARD', 'STORE', 'phone', 'STRING', '{E_RECEIPT}', 'From the store list', '(404) 555-0100'),
    ('store_email', 'Store Email', 'STANDARD', 'STORE', 'email', 'STRING', '{E_RECEIPT}', 'From the store list', 'buckhead@northwindapparel.example'),
    ('store_manager', 'Store Manager', 'STANDARD', 'STORE', 'manager', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_return_policy', 'Store Return Policy', 'STANDARD', 'STORE', 'return_policy', 'STRING', '{E_RECEIPT}', 'From the store list', 'Returns within 30 days with this receipt.'),
    ('store_url1', 'Store URL 1', 'STANDARD', 'STORE', 'url1', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_url2', 'Store URL 2', 'STANDARD', 'STORE', 'url2', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_url3', 'Store URL 3', 'STANDARD', 'STORE', 'url3', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_url4', 'Store URL 4', 'STANDARD', 'STORE', 'url4', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('store_image_url', 'Store Image URL', 'STANDARD', 'STORE', 'image_url', 'STRING', '{E_RECEIPT}', 'From the store list', ''),
    ('current_date', 'Current Date', 'SYSTEM', 'SYSTEM', 'today', 'DATE', '{EMAIL,E_RECEIPT,SMS,MMS}', 'The date of the send (same as today)', '2026-09-30')
ON CONFLICT (tag_key) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 18. DELIVERABILITY TESTS: the workspace's inbox-preview account and every test it ran
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deliverability_service (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenant(id),
    provider            VARCHAR(30) NOT NULL DEFAULT 'MAILGUN_INSPECT',
    region              VARCHAR(10) NOT NULL DEFAULT 'US',                 -- US | EU: which Mailgun API host
    username            VARCHAR(200),
    api_key_enc         TEXT,                                               -- encrypted with FIELD_ENCRYPTION_KEY
    default_clients     JSONB NOT NULL DEFAULT '[]'::jsonb,                 -- client ids a test renders in; empty = the service's own defaults
    image_blocking      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at     TIMESTAMPTZ,
    last_check_ok       BOOLEAN,
    last_check_error    TEXT,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_deliverability_service_region CHECK (region IN ('US', 'EU'))
);
COMMENT ON TABLE deliverability_service IS 'The workspace''s account with an inbox-preview service (Mailgun Inspect); one per tenant';
DROP TRIGGER IF EXISTS trg_deliverability_service_touch ON deliverability_service;
CREATE TRIGGER trg_deliverability_service_touch BEFORE UPDATE ON deliverability_service FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
ALTER TABLE deliverability_service ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverability_service FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deliverability_service_tenant ON deliverability_service;
CREATE POLICY rls_deliverability_service_tenant ON deliverability_service
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON deliverability_service TO cep_app;
GRANT ALL ON deliverability_service TO cep_admin;

CREATE TABLE IF NOT EXISTS deliverability_test (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    template_version    INTEGER NOT NULL,
    campaign_id         UUID REFERENCES campaign(id) ON DELETE SET NULL,
    kind                VARCHAR(20) NOT NULL DEFAULT 'PREVIEW',
    provider            VARCHAR(30) NOT NULL,
    provider_test_id    VARCHAR(100),
    status              VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    subject             VARCHAR(300),
    clients             JSONB NOT NULL DEFAULT '[]'::jsonb,
    summary             JSONB NOT NULL DEFAULT '{}'::jsonb,                 -- {"clients": n, "complete": n, "failed": n, "processing": n}
    results             JSONB NOT NULL DEFAULT '{}'::jsonb,                 -- per client: name, client, os, category, browser, status, screenshot, thumbnail
    error               TEXT,
    requested_by        UUID REFERENCES app_user(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),                 -- the allowance counts this (the provider bills on request)
    checked_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_deliverability_test_kind CHECK (kind IN ('PREVIEW', 'SPAM', 'PLACEMENT')),
    CONSTRAINT ck_deliverability_test_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED'))
);
COMMENT ON TABLE deliverability_test IS 'A test of a template''s content: inbox previews today; spam verdict and inbox placement have their slots (kind)';
CREATE INDEX IF NOT EXISTS ix_deliverability_test_template ON deliverability_test (tenant_id, template_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS ix_deliverability_test_month ON deliverability_test (tenant_id, requested_at);
DROP TRIGGER IF EXISTS trg_deliverability_test_touch ON deliverability_test;
CREATE TRIGGER trg_deliverability_test_touch BEFORE UPDATE ON deliverability_test FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
ALTER TABLE deliverability_test ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverability_test FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deliverability_test_tenant ON deliverability_test;
CREATE POLICY rls_deliverability_test_tenant ON deliverability_test
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON deliverability_test TO cep_app;
GRANT ALL ON deliverability_test TO cep_admin;

-- -------------------------------------------------------------------------------------
-- 19. LIST CHANNELS: what a contact list is for decides which column an upload must have
-- -------------------------------------------------------------------------------------
ALTER TABLE contact_list ADD COLUMN IF NOT EXISTS channel VARCHAR(10) NOT NULL DEFAULT 'EMAIL';   -- EMAIL | SMS | BOTH
ALTER TABLE contact_list DROP CONSTRAINT IF EXISTS ck_contact_list_channel;
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_channel CHECK (channel IN ('EMAIL', 'SMS', 'BOTH'));
COMMENT ON COLUMN contact_list.channel IS 'What the list is for: EMAIL (an email address per row), SMS (a mobile number per row), BOTH. Decides the required upload column and how a new person is recognised';
-- lists already attached to a text campaign were uploaded with emails and used for texts: both
UPDATE contact_list l SET channel = 'BOTH'
 WHERE l.channel = 'EMAIL' AND EXISTS (SELECT 1 FROM contact_list_campaign x JOIN campaign c ON c.id = x.campaign_id
                                        WHERE x.contact_list_id = l.id AND c.channel IN ('SMS', 'MMS') AND c.deleted_at IS NULL);

-- -------------------------------------------------------------------------------------
-- 20. CONTACT COMPLIANCE: an upload declares where its people agreed; a list can need approval before a send
--     The policy (what happens to people without consent, whether texts need a date, approval before the first send,
--     the consent lifetime, the attestation wording) lives in tenant.settings -> 'consent_policy'.
-- -------------------------------------------------------------------------------------
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS consent_basis VARCHAR(30);             -- WEB_FORM | IN_STORE | CUSTOMER_REQUEST | IMPLIED (a bought list is refused)
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS consent_collected_at VARCHAR(300);     -- where the consent was collected: a form, a store, a campaign
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS attested_by UUID;                      -- the user who confirmed these people agreed
ALTER TABLE contact_list_import ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ;
ALTER TABLE contact_list_import DROP CONSTRAINT IF EXISTS ck_contact_list_import_consent_basis;
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_consent_basis
    CHECK (consent_basis IS NULL OR consent_basis IN ('WEB_FORM', 'IN_STORE', 'CUSTOMER_REQUEST', 'IMPLIED'));
COMMENT ON COLUMN contact_list_import.consent_basis IS 'Where the people in the file agreed to marketing, declared by the uploader; kept on the list''s compliance record';
ALTER TABLE contact_list ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REQUIRED';  -- NOT_REQUIRED | AWAITING | APPROVED | REFUSED
ALTER TABLE contact_list ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE contact_list ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE contact_list ADD COLUMN IF NOT EXISTS approval_note VARCHAR(300);
ALTER TABLE contact_list DROP CONSTRAINT IF EXISTS ck_contact_list_approval_status;
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_approval_status CHECK (approval_status IN ('NOT_REQUIRED', 'AWAITING', 'APPROVED', 'REFUSED'));
COMMENT ON COLUMN contact_list.approval_status IS 'AWAITING or REFUSED: no campaign sends to this list (LIST_NOT_APPROVED in the audience build) until someone with consent.edit approves it';

-- -------------------------------------------------------------------------------------
-- 21. OBSERVABILITY: errors grouped by fingerprint, per-minute request figures per tenant, uptime probes
--     Platform-only tables (staff read them in the back-office; no tenant ever does), written on the platform connection.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS error_group (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fingerprint         VARCHAR(64) NOT NULL UNIQUE,                     -- sha256 of source, kind and the top in-app frames (or the message)
    source              VARCHAR(10) NOT NULL,                            -- BACKEND | BROWSER | JOB
    kind                VARCHAR(200) NOT NULL,                           -- the exception class, or the logger for an error without one
    message             TEXT NOT NULL,
    culprit             VARCHAR(300),                                    -- where: module.function, the route, or the page
    status              VARCHAR(10) NOT NULL DEFAULT 'OPEN',             -- OPEN | RESOLVED | IGNORED
    occurrences         BIGINT NOT NULL DEFAULT 0,
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
    regressed_at        TIMESTAMPTZ,                                     -- seen again after it was resolved
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID REFERENCES app_user(id),
    note                TEXT,
    CONSTRAINT ck_error_group_source CHECK (source IN ('BACKEND', 'BROWSER', 'JOB')),
    CONSTRAINT ck_error_group_status CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED'))
);
CREATE INDEX IF NOT EXISTS ix_error_group_last_seen ON error_group(status, last_seen DESC);
COMMENT ON TABLE error_group IS 'One row per distinct error (same source, kind and place): how often, since when, and whether someone dealt with it';

CREATE TABLE IF NOT EXISTS error_event (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id            BIGINT NOT NULL REFERENCES error_group(id) ON DELETE CASCADE,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id           UUID,                                            -- no foreign key: an error may concern a tenant being removed
    tenant_code         VARCHAR(50),
    user_id             UUID,
    method              VARCHAR(10),
    path                VARCHAR(500),
    status_code         INTEGER,
    release             VARCHAR(60),
    stack               TEXT,                                            -- capped at 16 KB
    context             JSONB NOT NULL DEFAULT '{}'                     -- browser, page, component stack, job name, correlation id
);
CREATE INDEX IF NOT EXISTS ix_error_event_group ON error_event(group_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_error_event_tenant ON error_event(tenant_id, occurred_at DESC);
COMMENT ON TABLE error_event IS 'Occurrences of an error group, sampled (at most a few per group per minute); pruned after errors.retention_days';

CREATE TABLE IF NOT EXISTS request_metric (
    tenant_id           UUID NOT NULL,                                   -- 00000000-0000-0000-0000-000000000000 for requests without a tenant (back-office, public pages)
    bucket_start        TIMESTAMPTZ NOT NULL,                            -- the minute
    method              VARCHAR(10) NOT NULL,
    route               VARCHAR(300) NOT NULL,                           -- the URL pattern, never the concrete path
    requests            INTEGER NOT NULL DEFAULT 0,
    client_errors       INTEGER NOT NULL DEFAULT 0,                      -- 4xx
    server_errors       INTEGER NOT NULL DEFAULT 0,                      -- 5xx
    total_ms            BIGINT NOT NULL DEFAULT 0,
    max_ms              INTEGER NOT NULL DEFAULT 0,
    histogram           INTEGER[] NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0}', -- counts under 50, 100, 250, 500, 1000, 2500, 5000, 10000 ms, and above
    PRIMARY KEY (tenant_id, bucket_start, method, route)
);
CREATE INDEX IF NOT EXISTS ix_request_metric_recent ON request_metric(bucket_start DESC);
COMMENT ON TABLE request_metric IS 'Per-minute request figures per tenant and route, added up by every API process; the back-office''s tenant performance reads them';

CREATE TABLE IF NOT EXISTS uptime_target (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                VARCHAR(100) NOT NULL UNIQUE,
    url                 VARCHAR(500) NOT NULL,
    expect_status       INTEGER NOT NULL DEFAULT 200,
    expect_text         VARCHAR(200),                                    -- optional: the body must contain it
    timeout_ms          INTEGER NOT NULL DEFAULT 5000,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    state               VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',          -- UP | DOWN | UNKNOWN
    state_since         TIMESTAMPTZ NOT NULL DEFAULT now(),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at     TIMESTAMPTZ,
    last_ms             INTEGER,
    last_error          VARCHAR(500),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_uptime_target_state CHECK (state IN ('UP', 'DOWN', 'UNKNOWN'))
);
COMMENT ON TABLE uptime_target IS 'Addresses the probe-uptime job calls every minute; DOWN after uptime.failures_before_alert failures in a row';

CREATE TABLE IF NOT EXISTS uptime_check (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_id           BIGINT NOT NULL REFERENCES uptime_target(id) ON DELETE CASCADE,
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ok                  BOOLEAN NOT NULL,
    status_code         INTEGER,
    duration_ms         INTEGER,
    error               VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS ix_uptime_check_target ON uptime_check(target_id, checked_at DESC);
COMMENT ON TABLE uptime_check IS 'Every probe of an uptime target; availability and response time are read from here';

GRANT SELECT, INSERT, UPDATE ON error_group, request_metric, uptime_target TO cep_app;
GRANT SELECT, INSERT ON error_event, uptime_check TO cep_app;
GRANT ALL ON error_group, error_event, request_metric, uptime_target, uptime_check TO cep_admin;

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('errors.retention_days', '30', 'INTEGER', 'Observability', 'Days error occurrences are kept; a resolved error not seen for this long is removed'),
    ('errors.spike_per_15_minutes', '25', 'INTEGER', 'Observability', 'Occurrences of one error within 15 minutes that make the Errors check fail and alert'),
    ('metrics.retention_days', '30', 'INTEGER', 'Observability', 'Days of per-minute request figures kept for tenant performance'),
    ('uptime.failures_before_alert', '2', 'INTEGER', 'Observability', 'Failed probes in a row before an uptime target is down and an alert goes out'),
    ('uptime.retention_days', '90', 'INTEGER', 'Observability', 'Days of uptime probes kept')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 22. ATTRIBUTION: orders from the shop (POST /orders/) and, when the workspace allows it, from the point of sale; each
--     credited to the campaign that earned it (a campaign code, else the last click, open or text within the windows);
--     the attribute-orders job rolls the credit up into campaign_actual, which Home, reports and campaign results read.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attributed_order (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    source              VARCHAR(10) NOT NULL,                            -- API | POS
    order_ref           VARCHAR(200) NOT NULL,                           -- unique per source: the shop's order id, or the point of sale's transaction key
    match_ref           VARCHAR(120) NOT NULL,                           -- what a refund names as its original: the order id, the POS transaction id
    kind                VARCHAR(10) NOT NULL DEFAULT 'ORDER',            -- ORDER | REFUND
    original_ref        VARCHAR(120),                                    -- a refund's original order (match_ref)
    party_id            VARCHAR(60),
    email               CITEXT,
    phone               VARCHAR(30),
    amount              NUMERIC(14,2) NOT NULL,                          -- the revenue counted; negative for a refund
    currency            CHAR(3) NOT NULL DEFAULT 'USD',
    ordered_at          TIMESTAMPTZ NOT NULL,
    channel             VARCHAR(10) NOT NULL DEFAULT 'ONLINE',           -- ONLINE | STORE | APP | PHONE | OTHER
    store_number        VARCHAR(40),
    campaign_code       VARCHAR(40),                                     -- named by the shop (a campaign's code or a coupon equal to it)
    coupon_codes        TEXT[] NOT NULL DEFAULT '{}',
    items               INTEGER,
    status              VARCHAR(12) NOT NULL DEFAULT 'PENDING',          -- PENDING | ATTRIBUTED | UNATTRIBUTED
    campaign_id         UUID REFERENCES campaign(id) ON DELETE SET NULL,
    touch_type          VARCHAR(10),                                     -- CODE | CLICK | OPEN | TEXT | REFUND (a refund follows its original)
    touch_at            TIMESTAMPTZ,
    touch_party_id      VARCHAR(60),
    note                VARCHAR(200),                                    -- why it was not attributed, in words
    attributed_at       TIMESTAMPTZ,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_attributed_order UNIQUE (tenant_id, source, order_ref),
    CONSTRAINT ck_attributed_order_source CHECK (source IN ('API', 'POS')),
    CONSTRAINT ck_attributed_order_kind CHECK (kind IN ('ORDER', 'REFUND')),
    CONSTRAINT ck_attributed_order_status CHECK (status IN ('PENDING', 'ATTRIBUTED', 'UNATTRIBUTED')),
    CONSTRAINT ck_attributed_order_touch CHECK (touch_type IS NULL OR touch_type IN ('CODE', 'CLICK', 'OPEN', 'TEXT', 'REFUND'))
);
CREATE INDEX IF NOT EXISTS ix_attributed_order_pending ON attributed_order(received_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_attributed_order_campaign ON attributed_order(tenant_id, campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_attributed_order_recent ON attributed_order(tenant_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS ix_attributed_order_match ON attributed_order(tenant_id, source, match_ref);
COMMENT ON TABLE attributed_order IS 'Orders and refunds the workspace sent for attribution, and the campaign each was credited to; no card or item data';
ALTER TABLE attributed_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE attributed_order FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_attributed_order_tenant ON attributed_order;
CREATE POLICY rls_attributed_order_tenant ON attributed_order
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON attributed_order TO cep_app;
GRANT ALL ON attributed_order TO cep_admin;

-- an order names a person by the address or number CEP sent to: find the person behind it
CREATE INDEX IF NOT EXISTS ix_mailer_execution_email ON mailer_execution(tenant_id, email_address);
CREATE INDEX IF NOT EXISTS ix_sms_execution_phone ON sms_execution(tenant_id, phone_number);

-- the shop's order calls are logged like the point of sale's
ALTER TABLE integration DROP CONSTRAINT IF EXISTS ck_integration_kind;
ALTER TABLE integration ADD CONSTRAINT ck_integration_kind CHECK (kind IN ('POS_RECEIPTS', 'PROVIDER', 'ORDERS', 'EVENTS', 'COUPONS'));

-- -------------------------------------------------------------------------------------
-- 23. COUPON / LOYALTY TIER (patch 0033): cached references for Journey's Issue Coupon and
--     Update Loyalty Tier action nodes. Per the BRD (do not rebuild loyalty/coupon as a new
--     action engine; invoke existing C360 services), these are non-authoritative synced
--     copies — same treatment as `segment` above, not a coupon or loyalty program engine.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupon (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    source_system       VARCHAR(40) NOT NULL DEFAULT 'C360',
    code                VARCHAR(100) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    discount_definition JSONB,                          -- {type: PERCENT|AMOUNT, value}, if exposed
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_system, code)
);
COMMENT ON TABLE coupon IS 'Cached reference to a C360 coupon definition; not owned/edited by CEP (do not rebuild coupon issuance)';
ALTER TABLE coupon ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coupon_tenant ON coupon;
CREATE POLICY rls_coupon_tenant ON coupon
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON coupon TO cep_app;
GRANT ALL ON coupon TO cep_admin;

CREATE TABLE IF NOT EXISTS loyalty_tier (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    source_system       VARCHAR(40) NOT NULL DEFAULT 'C360',
    code                VARCHAR(100) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    rank                INTEGER NOT NULL DEFAULT 0,      -- ordering only, e.g. Silver < Gold < Platinum
    description         TEXT,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_system, code)
);
COMMENT ON TABLE loyalty_tier IS 'Cached reference to a C360 loyalty tier; not owned/edited by CEP (do not rebuild the loyalty program)';
ALTER TABLE loyalty_tier ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tier FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_loyalty_tier_tenant ON loyalty_tier;
CREATE POLICY rls_loyalty_tier_tenant ON loyalty_tier
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON loyalty_tier TO cep_app;
GRANT ALL ON loyalty_tier TO cep_admin;

-- =====================================================================================
-- 24. JOURNEY APPROVE / SCHEDULE (phase 6i, Test Publish + Approve)
-- journey.status gains APPROVED (passed Test Publish, approved; live now or at scheduled_activate_at).
-- journey_version.status keeps its existing values (DRAFT/TEST_PUBLISHED/ACTIVE/RETIRED); a scheduled approval
-- leaves the version TEST_PUBLISHED and the journey APPROVED until the activate-scheduled-journeys job (run_scheduler
-- / workers.journey) flips both to ACTIVE at scheduled_activate_at. Neither column needed a CHECK constraint change:
-- both are plain VARCHAR, same as every other journey/journey_version status column.
-- =====================================================================================
ALTER TABLE journey ADD COLUMN IF NOT EXISTS scheduled_activate_at TIMESTAMPTZ;  -- set with status='APPROVED'; cleared once live
CREATE INDEX IF NOT EXISTS ix_journey_scheduled_activate ON journey(scheduled_activate_at) WHERE status = 'APPROVED';

-- =====================================================================================
-- 25. JOURNEY GOAL / EXIT CRITERIA (patch 0037, phase 6d, Journey Details)
-- Free text, not modeled logic: the engine has no notion of a "goal" or scored exit condition today (an enrollment
-- only ever ends ACTIVE/EXITED/COMPLETED, by whatever step it fell off of). Journey Details shows these as plain
-- read/write fields — a real content gap flagged rather than papered over, not a stand-in for the Setup modal (6e),
-- which will own full editing once it exists.
-- =====================================================================================
ALTER TABLE journey ADD COLUMN IF NOT EXISTS goal_description TEXT;             -- e.g. "First purchase in 30 days"
ALTER TABLE journey ADD COLUMN IF NOT EXISTS exit_criteria_description TEXT;    -- e.g. "Goal met · unsubscribe · 45 days"

-- =====================================================================================
-- 26. JOURNEY TEMPLATES (patch 0036): a workspace's own saved journey templates, and where a journey came from
-- A template is a snapshot of one journey version's graph (graph.py's wire format, entry_rules included) plus that
-- journey's setup (population, re-entry) and goal. Starting a journey from it copies the graph into the new journey's
-- version 1; the template itself never changes. Deleting a template is a soft delete: journeys made from it keep
-- working and keep pointing at it (journey.source_template_id). CEP's own starters live in code
-- (apps/journeys/starters.py); a journey made from one records its key in journey.source_starter_key.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS journey_template (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    category            VARCHAR(20) NOT NULL,                            -- LIFECYCLE, COMMERCE, LOYALTY, ENGAGEMENT
    population_mode     VARCHAR(30) NOT NULL,                            -- as journey.population_mode
    reentry_policy      VARCHAR(30) NOT NULL DEFAULT 'NEVER',            -- as journey.reentry_policy
    reentry_after_days  INTEGER,
    goal_description    TEXT,
    graph               JSONB NOT NULL,                                  -- {entry_rules, nodes, connections}, apps/journeys/graph.py
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_journey_template_category CHECK (category IN ('LIFECYCLE', 'COMMERCE', 'LOYALTY', 'ENGAGEMENT')),
    CONSTRAINT ck_journey_template_name CHECK (btrim(name) <> '')
);
COMMENT ON TABLE journey_template IS 'A workspace''s saved journey template: one journey version''s graph, setup and goal, copied into new journeys';
CREATE UNIQUE INDEX IF NOT EXISTS ux_journey_template_name_live ON journey_template(tenant_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_journey_template_tenant_category ON journey_template(tenant_id, category) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_journey_template_touch ON journey_template;
CREATE TRIGGER trg_journey_template_touch BEFORE UPDATE ON journey_template FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
DROP TRIGGER IF EXISTS trg_journey_template_audit ON journey_template;
CREATE TRIGGER trg_journey_template_audit AFTER INSERT OR UPDATE OR DELETE ON journey_template FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
ALTER TABLE journey_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_template FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_journey_template_tenant ON journey_template;
CREATE POLICY rls_journey_template_tenant ON journey_template
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON journey_template TO cep_app;
GRANT ALL ON journey_template TO cep_admin;

ALTER TABLE journey ADD COLUMN IF NOT EXISTS source_template_id UUID REFERENCES journey_template(id);  -- set when made from a saved template
ALTER TABLE journey ADD COLUMN IF NOT EXISTS source_starter_key VARCHAR(60);                            -- set when made from a CEP starter
ALTER TABLE journey DROP CONSTRAINT IF EXISTS ck_journey_source_one;
ALTER TABLE journey ADD CONSTRAINT ck_journey_source_one CHECK (source_template_id IS NULL OR source_starter_key IS NULL);
CREATE INDEX IF NOT EXISTS ix_journey_source_template ON journey(source_template_id) WHERE source_template_id IS NOT NULL;

-- -------------------------------------------------------------------------------------
-- 23. JOURNEY EVENTS AND COMPLETION: events in from the shop and the loyalty system (POST /events/), one event once
--     (external_id), coupon issue requests C360 fulfils, the Fixed population lock, and the EVENTS call-log kind.
-- -------------------------------------------------------------------------------------
ALTER TABLE journey_event ADD COLUMN IF NOT EXISTS external_id VARCHAR(120);   -- the sender's id for the event: sent twice, kept once
CREATE UNIQUE INDEX IF NOT EXISTS ux_journey_event_external ON journey_event(tenant_id, event_source, external_id, occurred_at) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_journey_event_recent ON journey_event(tenant_id, ingested_at DESC);
GRANT SELECT, INSERT ON journey_event TO cep_app;

ALTER TABLE journey_version ADD COLUMN IF NOT EXISTS population_frozen_at TIMESTAMPTZ;   -- Fixed population: nobody new enters after this
COMMENT ON COLUMN journey_version.population_frozen_at IS 'Fixed population: set by the first enrollment pass after go-live; nobody enters this version afterwards';
ALTER TABLE journey_version ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;          -- Date / Time entry: the schedule moment that last fired
COMMENT ON COLUMN journey_version.last_fired_at IS 'Date / Time entry rules: the latest schedule moment whose customers entered (apps/journeys/schedule.py); a moment fires once';

-- the Goal step (patch 0045, apps/journeys/goals.py): who converted, at which goal, and the revenue within its window
ALTER TABLE journey_enrollment
    ADD COLUMN IF NOT EXISTS converted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS converted_node_id  UUID,
    ADD COLUMN IF NOT EXISTS attributed_revenue NUMERIC(14,2);
COMMENT ON COLUMN journey_enrollment.converted_at IS 'The Goal step: the first matching event''s moment, set when the customer reaches the step or when the event arrives while they are in the journey';
CREATE INDEX IF NOT EXISTS ix_journey_enrollment_converted ON journey_enrollment(journey_id, converted_at) WHERE converted_at IS NOT NULL;
-- per-journey suppressions (patch 0046, apps/journeys/suppressions.py): customers one journey must never enter or message
CREATE TABLE IF NOT EXISTS journey_suppression (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id),
    journey_id  UUID NOT NULL REFERENCES journey(id) ON DELETE CASCADE,
    party_id    VARCHAR(60) NOT NULL,
    given       VARCHAR(200),                 -- what was typed: an email address, a mobile number or the customer id
    note        VARCHAR(200),
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_journey_suppression UNIQUE (journey_id, party_id)
);
CREATE INDEX IF NOT EXISTS ix_journey_suppression_tenant ON journey_suppression(tenant_id, journey_id);
ALTER TABLE journey_suppression ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_journey_suppression_tenant ON journey_suppression;
CREATE POLICY rls_journey_suppression_tenant ON journey_suppression
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_suppression FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON journey_suppression TO cep_app;
GRANT ALL ON journey_suppression TO cep_admin;
-- the Add to List step writes list members as JOURNEY
ALTER TABLE contact_list_member DROP CONSTRAINT IF EXISTS ck_contact_list_member_membership_source;
ALTER TABLE contact_list_member ADD CONSTRAINT ck_contact_list_member_membership_source
    CHECK (membership_source IN ('UPLOAD', 'RULE', 'SEGMENT', 'MANUAL', 'CLONE', 'JOURNEY'));
-- journey.export (the Customers card's CSV) and journey.suppress (per-journey suppressions): every role that edits journeys gets both
INSERT INTO permission (id, code, description) VALUES
    ('a3000000-0000-4000-8000-000000000018', 'journey.export', 'Journey export'),
    ('a3000000-0000-4000-8000-000000000019', 'journey.suppress', 'Journey suppress')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permission (role_id, permission_id)
    SELECT rp.role_id, p.id FROM role_permission rp
    JOIN permission edit ON edit.id = rp.permission_id AND edit.code = 'journey.edit'
    JOIN permission p ON p.code IN ('journey.export', 'journey.suppress')
ON CONFLICT DO NOTHING;

-- the nightly rollup gains the goal figures and the journey's message figures across every step
ALTER TABLE journey_master_analytical
    ADD COLUMN IF NOT EXISTS converted_count    INTEGER,
    ADD COLUMN IF NOT EXISTS attributed_revenue NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS sent_count         INTEGER,
    ADD COLUMN IF NOT EXISTS delivered_count    INTEGER,
    ADD COLUMN IF NOT EXISTS open_count         INTEGER,
    ADD COLUMN IF NOT EXISTS click_count        INTEGER,
    ADD COLUMN IF NOT EXISTS bounce_count       INTEGER,
    ADD COLUMN IF NOT EXISTS complaint_count    INTEGER,
    ADD COLUMN IF NOT EXISTS held_back_count    INTEGER,
    ADD COLUMN IF NOT EXISTS failed_count       INTEGER;

CREATE TABLE IF NOT EXISTS coupon_issuance (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    coupon_id           UUID NOT NULL REFERENCES coupon(id),
    party_id            VARCHAR(60) NOT NULL,
    journey_id          UUID REFERENCES journey(id) ON DELETE SET NULL,
    journey_node_key    VARCHAR(80),
    journey_enrollment_id UUID,
    status              VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',        -- REQUESTED | ISSUED | FAILED
    external_code       VARCHAR(120),                                    -- the customer's own code, when C360 sends one back
    note                VARCHAR(300),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    CONSTRAINT ck_coupon_issuance_status CHECK (status IN ('REQUESTED', 'ISSUED', 'FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_coupon_issuance_step ON coupon_issuance(tenant_id, journey_enrollment_id, journey_node_key) WHERE journey_enrollment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_coupon_issuance_open ON coupon_issuance(tenant_id, status, requested_at);
COMMENT ON TABLE coupon_issuance IS 'A journey asked for a C360 coupon to be given to a customer; C360 collects the requests (GET /coupon-issuances/) and marks them issued';
ALTER TABLE coupon_issuance ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_issuance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coupon_issuance_tenant ON coupon_issuance;
CREATE POLICY rls_coupon_issuance_tenant ON coupon_issuance
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON coupon_issuance TO cep_app;
GRANT ALL ON coupon_issuance TO cep_admin;

ALTER TABLE integration DROP CONSTRAINT IF EXISTS ck_integration_kind;
ALTER TABLE integration ADD CONSTRAINT ck_integration_kind CHECK (kind IN ('POS_RECEIPTS', 'PROVIDER', 'ORDERS', 'EVENTS', 'COUPONS'));

-- an approved journey waiting for its go-live time (Approve, Schedule for Later) is APPROVED: the core layer's list lacked it
ALTER TABLE journey DROP CONSTRAINT IF EXISTS ck_journey_status;
ALTER TABLE journey ADD CONSTRAINT ck_journey_status CHECK (status IN ('DRAFT', 'TEST', 'APPROVED', 'ACTIVE', 'PAUSED', 'ARCHIVED'));

-- =====================================================================================
-- 24. DELIVERABILITY TESTS: THE PLATFORM'S MAILGUN INSPECT ACCOUNT, TESTS BY PLAN, ADDED TESTS (patch 0039)
--     The platform's own account is the deliverability_service row without a tenant (back-office -> Configuration ->
--     Mailgun Inspect), like mail_server's platform row. A workspace without an account of its own runs its tests through
--     it, up to its plan's number plus the tests added for the month (tenant_quota_grant); a test remembers which account
--     ran it (deliverability_test.account) so its results are read from the same one and only the platform's count.
-- =====================================================================================
ALTER TABLE deliverability_service ALTER COLUMN tenant_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_deliverability_service_platform ON deliverability_service((tenant_id IS NULL)) WHERE tenant_id IS NULL;
COMMENT ON TABLE deliverability_service IS 'Accounts with an inbox-preview service (Mailgun Inspect): one per tenant that brings its own, plus the platform''s (tenant_id NULL) that the others use';

ALTER TABLE deliverability_test ADD COLUMN IF NOT EXISTS account VARCHAR(10) NOT NULL DEFAULT 'OWN';
ALTER TABLE deliverability_test DROP CONSTRAINT IF EXISTS ck_deliverability_test_account;
ALTER TABLE deliverability_test ADD CONSTRAINT ck_deliverability_test_account CHECK (account IN ('OWN', 'PLATFORM'));
COMMENT ON COLUMN deliverability_test.account IS 'Whose Mailgun account ran the test: OWN (the workspace''s) or PLATFORM (counted against the plan)';
-- the touch trigger (fn_touch_row) stamps updated_by, which this table never had: every update of a test (its progress, its results)
-- failed with "record new has no field updated_by", so a started test could never show its previews
ALTER TABLE deliverability_test ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id);

CREATE TABLE IF NOT EXISTS tenant_quota_grant (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    metric              VARCHAR(40) NOT NULL DEFAULT 'DELIVERABILITY_TESTS',
    period_month        DATE NOT NULL,                                      -- the month the added units count in; they end with it
    amount              INTEGER NOT NULL,
    note                VARCHAR(300),
    granted_by          UUID REFERENCES app_user(id),
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_by          UUID REFERENCES app_user(id),
    removed_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_tenant_quota_grant_metric CHECK (metric IN ('DELIVERABILITY_TESTS')),
    CONSTRAINT ck_tenant_quota_grant_amount CHECK (amount BETWEEN 1 AND 100000),
    CONSTRAINT ck_tenant_quota_grant_month CHECK (period_month = date_trunc('month', period_month)::date)
);
COMMENT ON TABLE tenant_quota_grant IS 'Units the platform team added to one tenant for one month (deliverability tests), on top of its plan; they end with the month';
CREATE INDEX IF NOT EXISTS ix_tenant_quota_grant_month ON tenant_quota_grant(tenant_id, metric, period_month) WHERE removed_at IS NULL;
ALTER TABLE tenant_quota_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_grant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_tenant_quota_grant_tenant ON tenant_quota_grant;
CREATE POLICY rls_tenant_quota_grant_tenant ON tenant_quota_grant
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT ON tenant_quota_grant TO cep_app;
GRANT ALL ON tenant_quota_grant TO cep_admin;

-- =====================================================================================
-- 25. USAGE METRICS: DELIVERABILITY TESTS (patch 0040)
-- The hourly rollup (billing.rollup_usage) records each tenant's deliverability tests per month since patch 0030, but the
-- metric was never allowed here, so every rollup failed on its last metric and the month's tests were never stored.
-- =====================================================================================
ALTER TABLE tenant_usage DROP CONSTRAINT IF EXISTS ck_tenant_usage_metric;
ALTER TABLE tenant_usage ADD CONSTRAINT ck_tenant_usage_metric
    CHECK (metric IN ('EMAIL_SENT', 'SMS_SENT', 'MMS_SENT', 'CONTACTS', 'STORAGE_BYTES', 'API_CALLS', 'DELIVERABILITY_TESTS'));

-- =====================================================================================
-- 28. DRIP STEPS (patch 0041): each message of a drip campaign is a row of its own
-- A drip sends several messages on a timetable to one audience, on one channel, all counted from the start date
-- (campaign.scheduled_at). Each step has its own name, day, optional send time (NULL = the series time,
-- campaign.drip_config.time), its own template copy, optional subject / preheader overrides and an optional A/B
-- subject test. Until the send engine reads these rows (phase B2), the API mirrors them into campaign.drip_config.steps
-- and campaign.template_id (the first step's template), which is what publish and the send engine read today.
-- tested_at / content_changed_at: a step counts as tested when tested_at is after content_changed_at (phase B3).
-- Existing drips: one row per drip_config step, pointing at the campaign's current template (not a copy, so
-- template_owned is FALSE: the drip never renames or removes that template).
-- =====================================================================================
CREATE TABLE IF NOT EXISTS campaign_drip_step (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    day                 INTEGER NOT NULL,                                -- days after the start date; 0 = the start date
    name                VARCHAR(200) NOT NULL DEFAULT '',                -- may be empty while a draft
    send_time           TIME,                                            -- NULL = the series time, drip_config.time
    template_id         UUID REFERENCES template_master(id),             -- this step's own copy; NULL until chosen
    template_owned      BOOLEAN NOT NULL DEFAULT FALSE,                  -- TRUE: the drip made template_id for this step (renamed, removed with it); FALSE: a shared template
    subject_line        VARCHAR(300),                                    -- NULL = the template's
    preheader           VARCHAR(300),
    ab_config           JSONB,                                           -- as campaign.ab_config; one step per drip, email only
    tested_at           TIMESTAMPTZ,
    content_changed_at  TIMESTAMPTZ,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ux_campaign_drip_step_day UNIQUE (campaign_id, day),
    CONSTRAINT ck_campaign_drip_step_day CHECK (day BETWEEN 0 AND 365)
);
COMMENT ON TABLE campaign_drip_step IS 'One message of a drip campaign: its day after the start date, send time, own template copy, subject / preheader overrides and A/B subject test';
CREATE INDEX IF NOT EXISTS ix_campaign_drip_step_tenant_campaign ON campaign_drip_step(tenant_id, campaign_id);
CREATE INDEX IF NOT EXISTS ix_campaign_drip_step_template ON campaign_drip_step(template_id);

DROP TRIGGER IF EXISTS trg_campaign_drip_step_touch ON campaign_drip_step;
CREATE TRIGGER trg_campaign_drip_step_touch BEFORE UPDATE ON campaign_drip_step FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
DROP TRIGGER IF EXISTS trg_campaign_drip_step_audit ON campaign_drip_step;
CREATE TRIGGER trg_campaign_drip_step_audit AFTER INSERT OR UPDATE OR DELETE ON campaign_drip_step FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
ALTER TABLE campaign_drip_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_drip_step FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_campaign_drip_step_tenant ON campaign_drip_step;
CREATE POLICY rls_campaign_drip_step_tenant ON campaign_drip_step
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_drip_step TO cep_app;
GRANT ALL ON campaign_drip_step TO cep_admin;

-- existing drips: a row per drip_config step, on the campaign's own template, so they publish and send exactly as before
INSERT INTO campaign_drip_step (tenant_id, campaign_id, day, name, template_id)
SELECT c.tenant_id, c.id, (step ->> 'day')::int, left(COALESCE(step ->> 'label', ''), 200), c.template_id
  FROM campaign c CROSS JOIN LATERAL jsonb_array_elements(c.drip_config -> 'steps') step
 WHERE c.campaign_type = 'DRIP' AND jsonb_typeof(c.drip_config -> 'steps') = 'array'
   AND (step ->> 'day') ~ '^\d+$' AND (step ->> 'day')::int BETWEEN 0 AND 365
ON CONFLICT (campaign_id, day) DO NOTHING;

-- =====================================================================================
-- 29. DRIP RUNS (patch 0042): each run of a drip knows the message it sends
-- A DRIP_INSTANCE run sends its step's own template, subject, preheader and A/B test, and builds its audience from the
-- first message's Campaign List (apps/delivery/engine/runs.py). Runs planned before patch 0042 are matched to their step
-- by their label ("Day 7" = the step on day 7 of the same campaign). A deleted step leaves its runs, unlinked.
-- =====================================================================================
ALTER TABLE campaign_run ADD COLUMN IF NOT EXISTS drip_step_id UUID REFERENCES campaign_drip_step(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_campaign_run_drip_step ON campaign_run(drip_step_id) WHERE drip_step_id IS NOT NULL;
COMMENT ON COLUMN campaign_run.drip_step_id IS 'DRIP_INSTANCE runs: the message (campaign_drip_step) this run sends';

UPDATE campaign_run r SET drip_step_id = s.id
  FROM campaign_drip_step s
 WHERE r.drip_step_id IS NULL AND r.run_type = 'DRIP_INSTANCE' AND NOT r.test_mode
   AND s.campaign_id = r.campaign_id AND r.sequence_label = 'Day ' || s.day;

-- =====================================================================================
-- 30. STOPPED DRIPS (patch 0043): a drip stopped early is COMPLETED, with who stopped it and when
-- Stop Remaining Messages cancels every unsent message of a running or paused drip for good (apps/campaigns/service.py,
-- stop). No new status: the campaign is COMPLETED and these two columns say it ended early.
-- =====================================================================================
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS stopped_by UUID REFERENCES app_user(id);
COMMENT ON COLUMN campaign.stopped_at IS 'A drip whose remaining messages were stopped: when. The campaign is COMPLETED';
COMMENT ON COLUMN campaign.stopped_by IS 'A drip whose remaining messages were stopped: who';

-- =====================================================================================
-- 31. PAUSED BY, AND SENDS THAT NEVER WENT (patch 0044)
-- campaign.paused_at / paused_by: who paused a campaign and when, set by pause and cleared by resume and stop (every
-- campaign type). not_sent_reason on the execution rows: a message CEP decided not to send after queuing it. Its status
-- stays FAILED (the status CHECKs are the hardening layer's, on partitioned tables), and this code tells it apart from a
-- real failure: the figures count it as not_sent, never failed, and billing never counts it.
--   STOPPED_EARLY   the drip was stopped while this send was paused (apps/campaigns/drip_lifecycle.py, stop)
-- =====================================================================================
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES app_user(id);
COMMENT ON COLUMN campaign.paused_at IS 'While paused: when it was paused. Cleared on resume and on stop';
COMMENT ON COLUMN campaign.paused_by IS 'While paused: who paused it';

ALTER TABLE mailer_execution ADD COLUMN IF NOT EXISTS not_sent_reason VARCHAR(30);
ALTER TABLE sms_execution ADD COLUMN IF NOT EXISTS not_sent_reason VARCHAR(30);
COMMENT ON COLUMN mailer_execution.not_sent_reason IS 'A queued message CEP chose not to send (status FAILED): STOPPED_EARLY. NULL for every other row';
COMMENT ON COLUMN sms_execution.not_sent_reason IS 'A queued message CEP chose not to send (status FAILED): STOPPED_EARLY. NULL for every other row';

-- rows written by a stop before the column existed carried only this text
UPDATE mailer_execution SET not_sent_reason = 'STOPPED_EARLY'
 WHERE not_sent_reason IS NULL AND status = 'FAILED' AND status_reason = 'Not sent: the drip was stopped early.';
UPDATE sms_execution SET not_sent_reason = 'STOPPED_EARLY'
 WHERE not_sent_reason IS NULL AND status = 'FAILED' AND status_reason = 'Not sent: the drip was stopped early.';

-- -------------------------------------------------------------------------------------
-- 0048: the suite's components (2026-10-15). The registry of what exists and its release state, what each plan
-- includes, and a workspace's own entries (a trial until a date, an add-on, or a component switched off). The API
-- resolves a workspace's components from these (apps/platform_ops/components.py) and GET /me/ hands the shell the list.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suite_component (
    key                 VARCHAR(20) PRIMARY KEY,                          -- cep, insights, crm, sales, pur, inv, pim
    name                VARCHAR(60) NOT NULL,
    tagline             VARCHAR(120) NOT NULL DEFAULT '',
    release             VARCHAR(10) NOT NULL DEFAULT 'PLANNED',           -- RELEASED, BETA (switchable), PLANNED (coming soon: cannot be switched on)
    needs               JSONB NOT NULL DEFAULT '[]',                      -- keys of the components this one depends on
    js_budget_kb        INTEGER,                                          -- the most compressed JavaScript the component may add when first opened
    sort_order          INTEGER NOT NULL DEFAULT 0,
    row_version         INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_suite_component_key CHECK (key ~ '^[a-z][a-z0-9_]{1,19}$'),
    CONSTRAINT ck_suite_component_release CHECK (release IN ('RELEASED', 'BETA', 'PLANNED'))
);

CREATE TABLE IF NOT EXISTS plan_component (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             UUID NOT NULL REFERENCES subscription_plan(id) ON DELETE CASCADE,
    component_key       VARCHAR(20) NOT NULL REFERENCES suite_component(key) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, component_key)
);

CREATE TABLE IF NOT EXISTS tenant_component (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    component_key       VARCHAR(20) NOT NULL REFERENCES suite_component(key) ON DELETE CASCADE,
    access              VARCHAR(10) NOT NULL,                             -- TRIAL (until a date), ADDON (billed on its own line), OFF (hidden although the plan includes it)
    until               DATE,
    row_version         INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, component_key),
    CONSTRAINT ck_tenant_component_access CHECK (access IN ('TRIAL', 'ADDON', 'OFF'))
);

INSERT INTO suite_component (key, name, tagline, release, needs, js_budget_kb, sort_order) VALUES
    ('cep',      'Engagement', 'Customer Engagement',            'RELEASED', '[]',             250, 10),
    ('insights', 'Insights',   'Reports, dashboards, datasets',  'PLANNED',  '[]',             150, 20),
    ('crm',      'CRM',        'Accounts, leads, opportunities', 'PLANNED',  '[]',             200, 30),
    ('sales',    'Sales',      'Orders, quotes, pricing',        'PLANNED',  '["crm", "pim"]', 200, 40),
    ('pur',      'Purchasing', 'Suppliers, purchase orders',     'PLANNED',  '["inv"]',        150, 50),
    ('inv',      'Inventory',  'Stock, locations, transfers',    'PLANNED',  '["pim"]',        150, 60),
    ('pim',      'PIM',        'Product information',            'PLANNED',  '[]',             150, 70)
ON CONFLICT (key) DO NOTHING;

-- every plan includes Engagement and Insights (decided 2026-10-15: Insights is on every plan from the start). Only a plan with
-- no components yet gets them, so a plan given fewer (the INSIGHTS plan, 0072) keeps what it was given when this layer runs again.
INSERT INTO plan_component (plan_id, component_key)
SELECT p.id, c.key FROM subscription_plan p CROSS JOIN suite_component c
 WHERE c.key IN ('cep', 'insights') AND NOT EXISTS (SELECT 1 FROM plan_component pc WHERE pc.plan_id = p.id)
ON CONFLICT (plan_id, component_key) DO NOTHING;

GRANT SELECT ON suite_component, plan_component, tenant_component TO cep_app;          -- the API resolves; the back-office decides
GRANT ALL ON suite_component, plan_component, tenant_component TO cep_admin;

-- -------------------------------------------------------------------------------------
-- 0049: Insights, the report engine's foundation (2026-10-16). The semantic catalogue (datasets, fields, sources),
-- a workspace's reports (definitions, versions, folders, shares, run audit), the per-workspace engine setting, the
-- reporting views the first datasets read, a read-only reporting role, the Insights global parameters, the report
-- permissions, and Insights released as Beta. apps/insights on the backend; apps/insights in the front end.
-- -------------------------------------------------------------------------------------

-- ---- the catalogue: platform-owned, read by every workspace through the API
CREATE TABLE IF NOT EXISTS report_dataset (
    key                 VARCHAR(40) PRIMARY KEY,                          -- messages, attributed_orders, contacts, journey_enrollments
    component_key       VARCHAR(20) NOT NULL REFERENCES suite_component(key),
    label               VARCHAR(100) NOT NULL,
    description         TEXT,
    workspace_field     VARCHAR(60) NOT NULL DEFAULT 'tenant_id',        -- the column every query is restricted on
    primary_key         VARCHAR(60) NOT NULL,
    time_field          VARCHAR(60),                                      -- the field a period filter applies to by default
    freshness_policy    VARCHAR(20) NOT NULL DEFAULT 'LIVE',              -- LIVE, MINUTES_5, HOURLY, DAILY
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, HIDDEN
    sort_order          INTEGER NOT NULL DEFAULT 0,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_report_dataset_key CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
    CONSTRAINT ck_report_dataset_status CHECK (status IN ('ACTIVE', 'HIDDEN'))
);

CREATE TABLE IF NOT EXISTS report_field (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_key         VARCHAR(40) NOT NULL REFERENCES report_dataset(key) ON DELETE CASCADE,
    key                 VARCHAR(60) NOT NULL,                             -- what a report definition names
    label               VARCHAR(100) NOT NULL,
    column_name         VARCHAR(60) NOT NULL,                             -- the column of the dataset's source
    type                VARCHAR(10) NOT NULL,                             -- string, number, date, datetime, boolean
    role                VARCHAR(10) NOT NULL,                             -- dimension, measure
    aggregates          JSONB NOT NULL DEFAULT '[]',                      -- a measure's allowed aggregates: sum, count, count_distinct, avg, min, max
    display_format      VARCHAR(20),                                      -- integer, decimal, money, percent, date, datetime
    sensitivity         VARCHAR(10) NOT NULL DEFAULT 'NORMAL',            -- NORMAL, PII (masked for roles without the right), CONFIDENTIAL (never offered)
    sort_order          INTEGER NOT NULL DEFAULT 0,
    formula             JSONB,                                            -- a calculated measure (patch 0059): {op, left, right, scale}; the compiler ignores column_name
    UNIQUE (dataset_key, key),
    CONSTRAINT ck_report_field_type CHECK (type IN ('string', 'number', 'date', 'datetime', 'boolean')),
    CONSTRAINT ck_report_field_role CHECK (role IN ('dimension', 'measure')),
    CONSTRAINT ck_report_field_sensitivity CHECK (sensitivity IN ('NORMAL', 'PII', 'CONFIDENTIAL'))
);
ALTER TABLE report_field ADD COLUMN IF NOT EXISTS formula JSONB;

CREATE TABLE IF NOT EXISTS report_dataset_source (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_key         VARCHAR(40) NOT NULL REFERENCES report_dataset(key) ON DELETE CASCADE,
    engine              VARCHAR(12) NOT NULL,                             -- postgresql, clickhouse
    source_name         VARCHAR(120) NOT NULL,                            -- schema.view the compiler reads
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
    UNIQUE (dataset_key, engine),
    CONSTRAINT ck_report_dataset_source_engine CHECK (engine IN ('postgresql', 'clickhouse'))
);

-- ---- a workspace's engine: which analytics engine runs its reports, and its limits
CREATE TABLE IF NOT EXISTS report_engine_setting (
    tenant_id           UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
    engine              VARCHAR(12) NOT NULL DEFAULT 'postgresql',
    connection_profile  VARCHAR(60) NOT NULL DEFAULT 'pg-reporting-shared',
    status              VARCHAR(12) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, MIGRATING, READ_ONLY
    freshness_sla       VARCHAR(12) NOT NULL DEFAULT 'LIVE',              -- LIVE, QUARTER_HOUR (ClickHouse, the refresh job's cadence), MINUTES_5, HOURLY, DAILY
    query_limits        JSONB NOT NULL DEFAULT '{}',                      -- statement_timeout_ms, preview_rows, run_rows, export_rows, concurrent
    last_reconciled_at  TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_report_engine_setting_engine CHECK (engine IN ('postgresql', 'clickhouse')),
    CONSTRAINT ck_report_engine_setting_status CHECK (status IN ('ACTIVE', 'MIGRATING', 'READ_ONLY'))
);

-- ---- a workspace's reports (row-level security, as every workspace table)
CREATE TABLE IF NOT EXISTS report_folder (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(120) NOT NULL,
    parent_id           UUID REFERENCES report_folder(id),
    owner_user_id       UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_folder_name CHECK (btrim(name) <> '')
);

CREATE TABLE IF NOT EXISTS report (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    folder_id           UUID REFERENCES report_folder(id),
    dataset_key         VARCHAR(40) NOT NULL REFERENCES report_dataset(key),
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    view_type           VARCHAR(20) NOT NULL DEFAULT 'grid',              -- grid, chart, pivot, hierarchy, influencers, decomposition
    definition          JSONB NOT NULL,                                   -- apps/insights/definition.py: columns, filters, groupBy, orderBy, views
    owner_user_id       UUID REFERENCES app_user(id),
    visibility          VARCHAR(10) NOT NULL DEFAULT 'PRIVATE',           -- PRIVATE (owner and shares), WORKSPACE (everyone with report.view)
    version             INTEGER NOT NULL DEFAULT 1,
    last_run_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_report_view_type CHECK (view_type IN ('grid', 'chart', 'pivot', 'hierarchy', 'influencers', 'decomposition')),
    CONSTRAINT ck_report_visibility CHECK (visibility IN ('PRIVATE', 'WORKSPACE'))
);
CREATE INDEX IF NOT EXISTS ix_report_tenant_live ON report(tenant_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    report_id           UUID NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    definition          JSONB NOT NULL,
    view_type           VARCHAR(20) NOT NULL,
    note                VARCHAR(300),
    changed_by          UUID REFERENCES app_user(id),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, version)
);

CREATE TABLE IF NOT EXISTS report_share (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    report_id           UUID NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    principal_kind      VARCHAR(10) NOT NULL,                             -- user, role
    principal_id        UUID NOT NULL,
    permission          VARCHAR(10) NOT NULL,                             -- view, edit, admin
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (report_id, principal_kind, principal_id),
    CONSTRAINT ck_report_share_kind CHECK (principal_kind IN ('user', 'role')),
    CONSTRAINT ck_report_share_permission CHECK (permission IN ('view', 'edit', 'admin'))
);

CREATE TABLE IF NOT EXISTS report_run_audit (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    report_id           UUID REFERENCES report(id) ON DELETE SET NULL,
    report_version      INTEGER,
    user_id             UUID REFERENCES app_user(id),
    dataset_key         VARCHAR(40) NOT NULL,
    kind                VARCHAR(10) NOT NULL,                             -- preview, run, export
    filter_signature    VARCHAR(64) NOT NULL,                             -- sha256 of the normalised definition
    duration_ms         INTEGER,
    row_count           INTEGER,
    outcome             VARCHAR(12) NOT NULL,                             -- OK, TIMEOUT, REFUSED, FAILED
    detail              VARCHAR(300),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_run_audit_tenant ON report_run_audit(tenant_id, started_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_folder', 'report', 'report_version', 'report_share', 'report_run_audit'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;

-- ---- the reporting views the first datasets read: one stable, documented shape per dataset, the workspace column first.
-- security_invoker: the row-level security of the tables underneath applies to whoever runs the report.
CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE VIEW reporting.rpt_messages WITH (security_invoker = true) AS
SELECT x.tenant_id, 'EMAIL'::text AS channel, x.id AS message_id, x.campaign_id, c.name AS campaign_name, c.campaign_type, c.code AS campaign_code,
       r.run_number, r.test_mode, x.party_id, x.status, x.status_reason, x.submitted_at, x.delivered_at, x.opened_at, x.clicked_at, x.bounced_at,
       x.created_at,
       (x.status NOT IN ('QUEUED', 'FAILED'))::int AS sent_n, (x.delivered_at IS NOT NULL)::int AS delivered_n, (x.opened_at IS NOT NULL)::int AS opened_n,
       (x.clicked_at IS NOT NULL)::int AS clicked_n, (x.bounced_at IS NOT NULL)::int AS bounced_n, (x.complained_at IS NOT NULL)::int AS complained_n,
       (x.status = 'FAILED')::int AS failed_n
  FROM mailer_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id
UNION ALL
SELECT x.tenant_id, 'SMS'::text, x.id, x.campaign_id, c.name, c.campaign_type, c.code, r.run_number, r.test_mode, x.party_id, x.status, x.status_reason,
       x.submitted_at, x.delivered_at, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, x.created_at,
       (x.status NOT IN ('QUEUED', 'FAILED'))::int, (x.delivered_at IS NOT NULL)::int, 0, 0, 0, 0, (x.status = 'FAILED')::int
  FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id JOIN campaign c ON c.id = x.campaign_id;

CREATE OR REPLACE VIEW reporting.rpt_attributed_orders WITH (security_invoker = true) AS
SELECT o.tenant_id, o.id AS order_id, o.order_ref, o.kind, o.source, o.amount, o.currency, o.ordered_at, o.channel, o.store_number, o.status,
       o.campaign_id, c.name AS campaign_name, o.touch_type, o.touch_at, o.attributed_at, o.received_at, o.items,
       (o.status = 'ATTRIBUTED')::int AS attributed_n
  FROM attributed_order o LEFT JOIN campaign c ON c.id = o.campaign_id;

CREATE OR REPLACE VIEW reporting.rpt_contacts WITH (security_invoker = true) AS
SELECT m.tenant_id, m.party_id, m.first_name, m.last_name, m.emails ->> 0 AS email, m.phones ->> 0 AS phone, m.source_system, m.is_synced_copy, m.synced_at,
       m.primary_address ->> 'city' AS city, m.primary_address ->> 'region' AS region, m.primary_address ->> 'country' AS country,
       (SELECT count(*) FROM contact_list_member lm WHERE lm.tenant_id = m.tenant_id AND lm.party_id = m.party_id) AS list_count
  FROM customer_master m;

CREATE OR REPLACE VIEW reporting.rpt_journey_enrollments WITH (security_invoker = true) AS
SELECT e.tenant_id, e.id AS enrollment_id, e.journey_id, j.name AS journey_name, j.code AS journey_code, j.status AS journey_status, e.party_id,
       e.status, e.enrolled_at, e.exited_at, e.exit_reason, e.converted_at, e.attributed_revenue,
       (e.converted_at IS NOT NULL)::int AS converted_n, (e.status = 'ACTIVE')::int AS active_n
  FROM journey_enrollment e JOIN journey j ON j.id = e.journey_id;

-- ---- the reporting role: reads the views and the tables beneath them, nothing else; the engine runs every report as it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_reporting') THEN CREATE ROLE cep_reporting NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA reporting TO cep_reporting, cep_app, cep_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO cep_reporting, cep_app, cep_admin;
GRANT SELECT ON mailer_execution, sms_execution, campaign_run, campaign, attributed_order, customer_master, contact_list_member, journey_enrollment, journey TO cep_reporting;
GRANT cep_reporting TO cep_app;                                           -- the API's connection switches to it for the query (SET LOCAL ROLE)

GRANT SELECT ON report_dataset, report_field, report_dataset_source, report_engine_setting TO cep_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_folder, report, report_version, report_share TO cep_app;
GRANT SELECT, INSERT ON report_run_audit TO cep_app;
GRANT USAGE, SELECT ON SEQUENCE report_run_audit_id_seq TO cep_app;
GRANT ALL ON report_dataset, report_field, report_dataset_source, report_engine_setting, report_folder, report, report_version, report_share, report_run_audit TO cep_admin;

-- ---- report engine connections (Phase E3): the analytics engines the back-office can point a workspace at, the password encrypted
CREATE TABLE IF NOT EXISTS report_engine_connection (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile             VARCHAR(60) NOT NULL UNIQUE,                      -- named on report_engine_setting.connection_profile
    engine              VARCHAR(12) NOT NULL DEFAULT 'clickhouse',
    url                 VARCHAR(300) NOT NULL,                            -- ClickHouse: the HTTP interface, http://host:8123
    username            VARCHAR(100),
    password_enc        TEXT,                                             -- Fernet, apps/platform_ops/crypto.py; never shown again
    database_name       VARCHAR(60) NOT NULL DEFAULT 'cep_reporting',
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, DISABLED
    notes               TEXT,
    last_tested_at      TIMESTAMPTZ,
    last_test_ok        BOOLEAN,
    last_test_error     VARCHAR(300),
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_engine_connection_engine CHECK (engine IN ('postgresql', 'clickhouse')),
    CONSTRAINT ck_report_engine_connection_status CHECK (status IN ('ACTIVE', 'DISABLED'))
);
GRANT SELECT ON report_engine_connection TO cep_app;
GRANT ALL ON report_engine_connection TO cep_admin;

-- ---- dashboards (Phase C): rows of tiles over a workspace's reports, one period for every tile (apps/insights/dashboards.py)
CREATE TABLE IF NOT EXISTS dashboard (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    visibility          VARCHAR(10) NOT NULL DEFAULT 'PRIVATE',           -- PRIVATE (the owner), WORKSPACE (everyone with report.view)
    period              JSONB NOT NULL DEFAULT '{"preset": "30d"}',       -- preset 7d, 30d, month, quarter or custom (from, to)
    compare             BOOLEAN NOT NULL DEFAULT false,                   -- figures show the change against the previous period
    layout              JSONB NOT NULL DEFAULT '{"rows": []}',            -- rows: [{width: 1 | 2 | 3 | 4 | 2-1, tiles: [{id, report_id, show, title, measure}]}]
    owner_user_id       UUID REFERENCES app_user(id),
    version             INTEGER NOT NULL DEFAULT 1,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_dashboard_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_dashboard_visibility CHECK (visibility IN ('PRIVATE', 'WORKSPACE'))
);
CREATE INDEX IF NOT EXISTS ix_dashboard_tenant_live ON dashboard(tenant_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS dashboard_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    dashboard_id        UUID NOT NULL REFERENCES dashboard(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    layout              JSONB NOT NULL,
    period              JSONB NOT NULL,
    note                VARCHAR(300),
    changed_by          UUID REFERENCES app_user(id),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_dashboard_version UNIQUE (dashboard_id, version)
);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['dashboard', 'dashboard_version'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard, dashboard_version TO cep_app;
GRANT ALL ON dashboard, dashboard_version TO cep_admin;

-- ---- sharing a dashboard with people and roles (patch 0060), as report_share does for a report (apps/insights/access.py)
CREATE TABLE IF NOT EXISTS dashboard_share (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    dashboard_id        UUID NOT NULL REFERENCES dashboard(id) ON DELETE CASCADE,
    principal_kind      VARCHAR(10) NOT NULL,                             -- user, role
    principal_id        UUID NOT NULL,
    permission          VARCHAR(10) NOT NULL,                             -- view, edit
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dashboard_id, principal_kind, principal_id),
    CONSTRAINT ck_dashboard_share_kind CHECK (principal_kind IN ('user', 'role')),
    CONSTRAINT ck_dashboard_share_permission CHECK (permission IN ('view', 'edit'))
);
CREATE INDEX IF NOT EXISTS ix_report_share_principal ON report_share(principal_kind, principal_id);
CREATE INDEX IF NOT EXISTS ix_dashboard_share_principal ON dashboard_share(principal_kind, principal_id);

-- ---- row access (patch 0060): the values of one field of a dataset a person or a role may see, in every report, tile, export and delivery
CREATE TABLE IF NOT EXISTS report_row_rule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    dataset_key         VARCHAR(80) NOT NULL,                             -- a platform dataset, or a workspace's own (x_...)
    field_key           VARCHAR(60) NOT NULL,
    principal_kind      VARCHAR(10) NOT NULL,                             -- user, role
    principal_id        UUID NOT NULL,
    allowed             JSONB NOT NULL DEFAULT '[]',                      -- the values, typed as the field
    note                VARCHAR(200),
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, dataset_key, field_key, principal_kind, principal_id),
    CONSTRAINT ck_report_row_rule_kind CHECK (principal_kind IN ('user', 'role'))
);
CREATE INDEX IF NOT EXISTS ix_report_row_rule_lookup ON report_row_rule(tenant_id, dataset_key, principal_kind, principal_id);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['dashboard_share', 'report_row_rule'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_share, report_row_rule TO cep_app;
GRANT ALL ON dashboard_share, report_row_rule TO cep_admin;

-- ---- saved views of a dashboard (patch 0061): a period, slicer picks, cross-filters, the page and the tiles' drills, under a name
CREATE TABLE IF NOT EXISTS dashboard_view (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    dashboard_id        UUID NOT NULL REFERENCES dashboard(id) ON DELETE CASCADE,
    owner_user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    name                VARCHAR(80) NOT NULL,
    state               JSONB NOT NULL DEFAULT '{}',
    shared              BOOLEAN NOT NULL DEFAULT FALSE,                   -- shared by an editor with everyone who opens the dashboard
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dashboard_view_dashboard ON dashboard_view(dashboard_id, owner_user_id);

-- ---- which reports and dashboards people open (patch 0061): one row per opening, a person's repeat within ten minutes not counted
CREATE TABLE IF NOT EXISTS insights_usage (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    kind                VARCHAR(10) NOT NULL,                             -- report, dashboard
    item_id             UUID NOT NULL,
    user_id             UUID REFERENCES app_user(id) ON DELETE SET NULL,  -- empty for an embed
    via                 VARCHAR(10) NOT NULL DEFAULT 'app',               -- app, embed
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_insights_usage_kind CHECK (kind IN ('report', 'dashboard')),
    CONSTRAINT ck_insights_usage_via CHECK (via IN ('app', 'embed'))
);
CREATE INDEX IF NOT EXISTS ix_insights_usage_opened ON insights_usage(tenant_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS ix_insights_usage_item ON insights_usage(tenant_id, kind, item_id, opened_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['dashboard_view', 'insights_usage'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON dashboard_view, insights_usage TO cep_app;
GRANT USAGE, SELECT ON SEQUENCE insights_usage_id_seq TO cep_app;
GRANT ALL ON dashboard_view, insights_usage TO cep_admin;

-- ---- embed links (patch 0061): a report or a dashboard shown read-only on another site through a secret link. Only the hash of the
-- secret is kept. Not under row-level security: the public page finds the link, and its workspace, by the hash alone, on the
-- control plane; every query the app makes on a workspace's behalf names its tenant_id.
CREATE TABLE IF NOT EXISTS insights_embed (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    kind                VARCHAR(10) NOT NULL,                             -- report, dashboard
    item_id             UUID NOT NULL,
    token_hash          VARCHAR(64) NOT NULL UNIQUE,                      -- sha256 of the secret, hex
    label               VARCHAR(100),
    created_by          UUID NOT NULL REFERENCES app_user(id),            -- the link shows what this person may see
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    uses                INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT ck_insights_embed_kind CHECK (kind IN ('report', 'dashboard'))
);
CREATE INDEX IF NOT EXISTS ix_insights_embed_item ON insights_embed(tenant_id, kind, item_id);
GRANT SELECT, INSERT, UPDATE ON insights_embed TO cep_app;
GRANT ALL ON insights_embed TO cep_admin;

-- ---- links between the platform's datasets (patch 0061): two datasets that share a dimension, so a report on one can add measures
-- of the other, each totalled on its own and joined on the shared dimension (apps/insights/links.py). Kept in the back-office.
CREATE TABLE IF NOT EXISTS report_dataset_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_dataset        VARCHAR(40) NOT NULL REFERENCES report_dataset(key) ON DELETE CASCADE,
    to_dataset          VARCHAR(40) NOT NULL REFERENCES report_dataset(key) ON DELETE CASCADE,
    label               VARCHAR(100) NOT NULL,
    pairs               JSONB NOT NULL,                                   -- [[from field, to field], ...]: the shared dimensions
    time_pair           JSONB,                                            -- [from time field, to time field]: a period on one applies to the other
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, HIDDEN
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (from_dataset, to_dataset),
    CONSTRAINT ck_report_dataset_link_status CHECK (status IN ('ACTIVE', 'HIDDEN'))
);
GRANT SELECT ON report_dataset_link TO cep_app;
GRANT ALL ON report_dataset_link TO cep_admin;

-- ---- favourites (Phase C): a person's starred reports and dashboards, first in their lists (apps/insights/library.py)
CREATE TABLE IF NOT EXISTS report_favourite (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    user_id             UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    kind                VARCHAR(10) NOT NULL,                             -- report, dashboard
    item_id             UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, kind, item_id),
    CONSTRAINT ck_report_favourite_kind CHECK (kind IN ('report', 'dashboard'))
);
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_favourite'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, DELETE ON report_favourite TO cep_app;
GRANT ALL ON report_favourite TO cep_admin;

-- ---- scheduled delivery (Phase E): a report emailed on a schedule, and each sending (apps/insights/schedules.py, workers/insights_delivery.py)
CREATE TABLE IF NOT EXISTS report_schedule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    kind                VARCHAR(10) NOT NULL DEFAULT 'report',            -- report (dashboard with the PDF slice)
    item_id             UUID NOT NULL,
    owner_user_id       UUID REFERENCES app_user(id),                     -- whose rights and masking the file is built with
    every               VARCHAR(10) NOT NULL,                             -- day, weekday, week, month
    on_day              SMALLINT,                                         -- week: 1 (Monday) to 7; month: 1 to 28
    at_time             TIME NOT NULL,                                    -- in the workspace's zone
    format              VARCHAR(5) NOT NULL DEFAULT 'xlsx',               -- xlsx, csv (pdf with the PDF slice)
    recipients          JSONB NOT NULL,                                   -- ["a@b.c", ...]
    subject             VARCHAR(200),                                     -- {date} is the sending date; empty: "<report> · {date}"
    note                TEXT,
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, PAUSED (by hand, or after three failures in a row)
    failures            SMALLINT NOT NULL DEFAULT 0,
    last_sent_at        TIMESTAMPTZ,
    last_outcome        VARCHAR(12),
    last_detail         VARCHAR(300),
    next_run_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_schedule_kind CHECK (kind IN ('report', 'dashboard')),
    CONSTRAINT ck_report_schedule_every CHECK (every IN ('day', 'weekday', 'week', 'month')),
    CONSTRAINT ck_report_schedule_format CHECK (format IN ('xlsx', 'csv', 'pdf')),
    CONSTRAINT ck_report_schedule_status CHECK (status IN ('ACTIVE', 'PAUSED'))
);
CREATE INDEX IF NOT EXISTS ix_report_schedule_due ON report_schedule(next_run_at) WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS report_delivery (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    schedule_id         UUID NOT NULL REFERENCES report_schedule(id) ON DELETE CASCADE,
    trigger             VARCHAR(10) NOT NULL DEFAULT 'schedule',          -- schedule, test
    outcome             VARCHAR(12) NOT NULL,                             -- OK, TIMEOUT, REFUSED, FAILED
    detail              VARCHAR(300),
    recipients          SMALLINT NOT NULL DEFAULT 0,
    row_count           INTEGER,
    duration_ms         INTEGER,
    sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_report_delivery_schedule ON report_delivery(schedule_id, sent_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_schedule', 'report_delivery'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedule TO cep_app;
GRANT SELECT, INSERT ON report_delivery TO cep_app;
GRANT USAGE, SELECT ON SEQUENCE report_delivery_id_seq TO cep_app;
GRANT ALL ON report_schedule, report_delivery TO cep_admin;
GRANT ALL ON SEQUENCE report_run_audit_id_seq TO cep_admin;

-- ---- threshold alerts (patch 0062): a report's value checked every hour or every day, an email when it crosses the threshold
-- (once, until it is back), each check kept (apps/insights/alerts.py, workers/insights_alerts.py)
CREATE TABLE IF NOT EXISTS report_alert (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    report_id           UUID NOT NULL REFERENCES report(id) ON DELETE CASCADE,
    owner_user_id       UUID NOT NULL REFERENCES app_user(id),            -- whose rights and masking the value is read with
    name                VARCHAR(120),
    measure             VARCHAR(60) NOT NULL,                             -- the report's value: a measure column's field key
    op                  VARCHAR(2) NOT NULL,                              -- <, <=, >, >=
    threshold           NUMERIC NOT NULL,
    every               VARCHAR(5) NOT NULL DEFAULT 'day',                -- hour, day
    at_time             TIME,                                             -- day: in the workspace's zone
    recipients          JSONB NOT NULL,                                   -- ["a@b.c", ...]
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, PAUSED
    state               VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',           -- UNKNOWN, OK, TRIGGERED: an email goes on the way into TRIGGERED
    last_value          NUMERIC,
    last_checked_at     TIMESTAMPTZ,
    last_fired_at       TIMESTAMPTZ,
    last_detail         VARCHAR(300),
    failures            SMALLINT NOT NULL DEFAULT 0,
    next_check_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_alert_op CHECK (op IN ('<', '<=', '>', '>=')),
    CONSTRAINT ck_report_alert_every CHECK (every IN ('hour', 'day')),
    CONSTRAINT ck_report_alert_status CHECK (status IN ('ACTIVE', 'PAUSED')),
    CONSTRAINT ck_report_alert_state CHECK (state IN ('UNKNOWN', 'OK', 'TRIGGERED'))
);
CREATE INDEX IF NOT EXISTS ix_report_alert_due ON report_alert(tenant_id, next_check_at) WHERE deleted_at IS NULL AND status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_report_alert_report ON report_alert(tenant_id, report_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS report_alert_check (
    id                  BIGSERIAL PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    alert_id            UUID NOT NULL REFERENCES report_alert(id) ON DELETE CASCADE,
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    trigger             VARCHAR(10) NOT NULL DEFAULT 'schedule',          -- schedule, now
    value               NUMERIC,
    met                 BOOLEAN,
    notified            BOOLEAN NOT NULL DEFAULT FALSE,
    outcome             VARCHAR(12) NOT NULL,                             -- OK, FAILED, REFUSED, TIMEOUT
    detail              VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_report_alert_check_alert ON report_alert_check(alert_id, checked_at DESC);

-- ---- comments and annotations (patch 0062): notes on a report or a dashboard, on the whole, on a tile, or on one value of a chart
CREATE TABLE IF NOT EXISTS insights_comment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    kind                VARCHAR(10) NOT NULL,                             -- report, dashboard
    item_id             UUID NOT NULL,
    author_user_id      UUID REFERENCES app_user(id) ON DELETE SET NULL,
    body                TEXT NOT NULL,
    anchor              JSONB,                                            -- {tile_id?, field?, value?, label?}: what the note is on
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at           TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    CONSTRAINT ck_insights_comment_kind CHECK (kind IN ('report', 'dashboard'))
);
CREATE INDEX IF NOT EXISTS ix_insights_comment_item ON insights_comment(tenant_id, kind, item_id, created_at) WHERE deleted_at IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_alert', 'report_alert_check', 'insights_comment'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_alert, report_alert_check, insights_comment TO cep_app;
GRANT USAGE, SELECT ON SEQUENCE report_alert_check_id_seq TO cep_app;
GRANT ALL ON report_alert, report_alert_check, insights_comment TO cep_admin;

-- ---- PowerPoint (patch 0062): a schedule may send a .pptx
ALTER TABLE report_schedule DROP CONSTRAINT IF EXISTS ck_report_schedule_format;
ALTER TABLE report_schedule ADD CONSTRAINT ck_report_schedule_format CHECK (format IN ('xlsx', 'csv', 'pdf', 'pptx'));

-- ---- the first datasets: what Reports already shows, as catalogue entries
INSERT INTO report_dataset (key, component_key, label, description, primary_key, time_field, sort_order) VALUES
    ('messages',            'cep', 'Messages',            'Every email and text a campaign sent: who, when, and what became of it',        'message_id',    'submitted_at', 10),
    ('attributed_orders',   'cep', 'Attributed Orders',   'Orders the shop reported, and the campaign each was credited to',                'order_id',      'ordered_at',   20),
    ('contacts',            'cep', 'Contacts',            'The customer records the workspace can reach',                                    'party_id',      NULL,           30),
    ('journey_enrollments', 'cep', 'Journey Enrollments', 'Every customer a journey took in: where they are, how they left, what they bought', 'enrollment_id', 'enrolled_at',  40)
ON CONFLICT (key) DO NOTHING;

INSERT INTO report_dataset_source (dataset_key, engine, source_name) VALUES
    ('messages', 'postgresql', 'reporting.rpt_messages'),
    ('attributed_orders', 'postgresql', 'reporting.rpt_attributed_orders'),
    ('contacts', 'postgresql', 'reporting.rpt_contacts'),
    ('journey_enrollments', 'postgresql', 'reporting.rpt_journey_enrollments')
ON CONFLICT (dataset_key, engine) DO NOTHING;
-- the same datasets on ClickHouse (Phase E3): the reporting tables apps/insights/clickhouse.py creates and loads
INSERT INTO report_dataset_source (dataset_key, engine, source_name) VALUES
    ('messages', 'clickhouse', 'cep_reporting.rpt_messages'),
    ('attributed_orders', 'clickhouse', 'cep_reporting.rpt_attributed_orders'),
    ('contacts', 'clickhouse', 'cep_reporting.rpt_contacts'),
    ('journey_enrollments', 'clickhouse', 'cep_reporting.rpt_journey_enrollments')
ON CONFLICT (dataset_key, engine) DO NOTHING;

INSERT INTO report_field (dataset_key, key, label, column_name, type, role, aggregates, display_format, sensitivity, sort_order) VALUES
    ('messages', 'channel',        'Channel',         'channel',        'string',   'dimension', '[]', NULL, 'NORMAL', 10),
    ('messages', 'campaign_name',  'Campaign',        'campaign_name',  'string',   'dimension', '[]', NULL, 'NORMAL', 20),
    ('messages', 'campaign_code',  'Campaign Code',   'campaign_code',  'string',   'dimension', '[]', NULL, 'NORMAL', 30),
    ('messages', 'campaign_type',  'Campaign Type',   'campaign_type',  'string',   'dimension', '[]', NULL, 'NORMAL', 40),
    ('messages', 'status',         'Status',          'status',         'string',   'dimension', '[]', NULL, 'NORMAL', 50),
    ('messages', 'submitted_at',   'Sent',            'submitted_at',   'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 60),
    ('messages', 'delivered_at',   'Delivered',       'delivered_at',   'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 70),
    ('messages', 'party_id',       'Customer',        'party_id',       'string',   'dimension', '[]', NULL, 'PII', 80),
    ('messages', 'test_mode',      'Test Send',       'test_mode',      'boolean',  'dimension', '[]', NULL, 'NORMAL', 90),
    ('messages', 'messages',       'Messages',        'message_id',     'number',   'measure',   '["count"]', 'integer', 'NORMAL', 100),
    ('messages', 'sent',           'Sent Count',      'sent_n',         'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 110),
    ('messages', 'delivered',      'Delivered Count', 'delivered_n',    'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 120),
    ('messages', 'opened',         'Opened',          'opened_n',       'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 130),
    ('messages', 'clicked',        'Clicked',         'clicked_n',      'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 140),
    ('messages', 'bounced',        'Bounced',         'bounced_n',      'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 150),
    ('messages', 'complained',     'Complaints',      'complained_n',   'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 160),
    ('messages', 'failed',         'Failed',          'failed_n',       'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 170),
    ('attributed_orders', 'order_ref',     'Order',          'order_ref',     'string',   'dimension', '[]', NULL, 'NORMAL', 10),
    ('attributed_orders', 'kind',          'Kind',           'kind',          'string',   'dimension', '[]', NULL, 'NORMAL', 20),
    ('attributed_orders', 'status',        'Status',         'status',        'string',   'dimension', '[]', NULL, 'NORMAL', 30),
    ('attributed_orders', 'channel',       'Channel',        'channel',       'string',   'dimension', '[]', NULL, 'NORMAL', 40),
    ('attributed_orders', 'store_number',  'Store',          'store_number',  'string',   'dimension', '[]', NULL, 'NORMAL', 50),
    ('attributed_orders', 'campaign_name', 'Credited To',    'campaign_name', 'string',   'dimension', '[]', NULL, 'NORMAL', 60),
    ('attributed_orders', 'touch_type',    'Touch',          'touch_type',    'string',   'dimension', '[]', NULL, 'NORMAL', 70),
    ('attributed_orders', 'ordered_at',    'Placed',         'ordered_at',    'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 80),
    ('attributed_orders', 'currency',      'Currency',       'currency',      'string',   'dimension', '[]', NULL, 'NORMAL', 90),
    ('attributed_orders', 'orders',        'Orders',         'order_id',      'number',   'measure',   '["count"]', 'integer', 'NORMAL', 100),
    ('attributed_orders', 'amount',        'Amount',         'amount',        'number',   'measure',   '["sum", "avg", "min", "max"]', 'money', 'NORMAL', 110),
    ('attributed_orders', 'items',         'Items',          'items',         'number',   'measure',   '["sum", "avg"]', 'integer', 'NORMAL', 120),
    ('attributed_orders', 'attributed',    'Attributed',     'attributed_n',  'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 130),
    ('contacts', 'party_id',      'Customer ID',  'party_id',      'string',   'dimension', '[]', NULL, 'PII', 10),
    ('contacts', 'first_name',    'First Name',   'first_name',    'string',   'dimension', '[]', NULL, 'PII', 20),
    ('contacts', 'last_name',     'Last Name',    'last_name',     'string',   'dimension', '[]', NULL, 'PII', 30),
    ('contacts', 'email',         'Email',        'email',         'string',   'dimension', '[]', NULL, 'PII', 40),
    ('contacts', 'phone',         'Phone',        'phone',         'string',   'dimension', '[]', NULL, 'PII', 50),
    ('contacts', 'city',          'City',         'city',          'string',   'dimension', '[]', NULL, 'NORMAL', 60),
    ('contacts', 'region',        'Region',       'region',        'string',   'dimension', '[]', NULL, 'NORMAL', 70),
    ('contacts', 'country',       'Country',      'country',       'string',   'dimension', '[]', NULL, 'NORMAL', 80),
    ('contacts', 'source_system', 'Source',       'source_system', 'string',   'dimension', '[]', NULL, 'NORMAL', 90),
    ('contacts', 'synced_at',     'Synced',       'synced_at',     'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 100),
    ('contacts', 'contacts',      'Contacts',     'party_id',      'number',   'measure',   '["count"]', 'integer', 'NORMAL', 110),
    ('contacts', 'list_count',    'Lists',        'list_count',    'number',   'measure',   '["sum", "avg", "max"]', 'integer', 'NORMAL', 120),
    ('journey_enrollments', 'journey_name',   'Journey',        'journey_name',       'string',   'dimension', '[]', NULL, 'NORMAL', 10),
    ('journey_enrollments', 'journey_code',   'Journey Code',   'journey_code',       'string',   'dimension', '[]', NULL, 'NORMAL', 20),
    ('journey_enrollments', 'journey_status', 'Journey Status', 'journey_status',     'string',   'dimension', '[]', NULL, 'NORMAL', 30),
    ('journey_enrollments', 'status',         'Status',         'status',             'string',   'dimension', '[]', NULL, 'NORMAL', 40),
    ('journey_enrollments', 'exit_reason',    'Exit Reason',    'exit_reason',        'string',   'dimension', '[]', NULL, 'NORMAL', 50),
    ('journey_enrollments', 'enrolled_at',    'Entered',        'enrolled_at',        'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 60),
    ('journey_enrollments', 'exited_at',      'Left',           'exited_at',          'datetime', 'dimension', '[]', 'datetime', 'NORMAL', 70),
    ('journey_enrollments', 'party_id',       'Customer',       'party_id',           'string',   'dimension', '[]', NULL, 'PII', 80),
    ('journey_enrollments', 'enrollments',    'Enrollments',    'enrollment_id',      'number',   'measure',   '["count"]', 'integer', 'NORMAL', 90),
    ('journey_enrollments', 'active',         'Active',         'active_n',           'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 100),
    ('journey_enrollments', 'converted',      'Converted',      'converted_n',        'number',   'measure',   '["sum"]', 'integer', 'NORMAL', 110),
    ('journey_enrollments', 'revenue',        'Revenue',        'attributed_revenue', 'number',   'measure',   '["sum", "avg"]', 'money', 'NORMAL', 120)
ON CONFLICT (dataset_key, key) DO NOTHING;

-- ---- calculated measures (patch 0059): a formula over the dataset's other measures; the column is a placeholder
INSERT INTO report_field (dataset_key, key, label, column_name, type, role, aggregates, display_format, sensitivity, sort_order, formula) VALUES
    ('messages', 'delivered_rate', 'Delivered Rate', 'delivered_rate', 'number', 'measure', '["calc"]', 'percent', 'NORMAL', 180,
     '{"op": "ratio", "left": {"field": "delivered", "aggregate": "sum"}, "right": {"field": "sent", "aggregate": "sum"}, "scale": 100}'),
    ('messages', 'open_rate',      'Open Rate',      'open_rate',      'number', 'measure', '["calc"]', 'percent', 'NORMAL', 190,
     '{"op": "ratio", "left": {"field": "opened", "aggregate": "sum"}, "right": {"field": "delivered", "aggregate": "sum"}, "scale": 100}'),
    ('messages', 'click_rate',     'Click Rate',     'click_rate',     'number', 'measure', '["calc"]', 'percent', 'NORMAL', 200,
     '{"op": "ratio", "left": {"field": "clicked", "aggregate": "sum"}, "right": {"field": "delivered", "aggregate": "sum"}, "scale": 100}'),
    ('messages', 'bounce_rate',    'Bounce Rate',    'bounce_rate',    'number', 'measure', '["calc"]', 'percent', 'NORMAL', 210,
     '{"op": "ratio", "left": {"field": "bounced", "aggregate": "sum"}, "right": {"field": "sent", "aggregate": "sum"}, "scale": 100}'),
    ('attributed_orders', 'average_order', 'Average Order Value', 'average_order', 'number', 'measure', '["calc"]', 'money', 'NORMAL', 140,
     '{"op": "ratio", "left": {"field": "amount", "aggregate": "sum"}, "right": {"field": "orders", "aggregate": "count"}}'),
    ('journey_enrollments', 'conversion_rate', 'Conversion Rate', 'conversion_rate', 'number', 'measure', '["calc"]', 'percent', 'NORMAL', 130,
     '{"op": "ratio", "left": {"field": "converted", "aggregate": "sum"}, "right": {"field": "enrollments", "aggregate": "count"}, "scale": 100}')
ON CONFLICT (dataset_key, key) DO NOTHING;

-- ---- the first links between the platform's datasets (patch 0061), once both datasets are there
INSERT INTO report_dataset_link (from_dataset, to_dataset, label, pairs, time_pair, sort_order) VALUES
    ('messages', 'attributed_orders', 'Orders credited to the campaign', '[["campaign_name", "campaign_name"], ["channel", "channel"]]', '["submitted_at", "ordered_at"]', 10),
    ('attributed_orders', 'messages', 'Messages of the campaign', '[["campaign_name", "campaign_name"], ["channel", "channel"]]', '["ordered_at", "submitted_at"]', 20)
ON CONFLICT (from_dataset, to_dataset) DO NOTHING;

-- ---- the Insights global parameters (Platform admin -> Global Parameters)
INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('insights.mode',            '"integrated"', 'STRING',  'Insights', 'How Insights is offered: integrated (an Insights item in each component''s menu), standalone (its own app in the launcher), or both'),
    ('insights.standalone_path', '"/insights"',  'STRING',  'Insights', 'Where the standalone Insights app answers: a path on this host'),
    ('insights.engine_url',      '""',           'STRING',  'Insights', 'The internal address of the report engine service; empty means this backend runs reports itself')
ON CONFLICT (key) DO NOTHING;

-- ---- the report permissions: view and run (report.view, since 2026-09), build (report.edit), share and administer (report.admin)
INSERT INTO permission (id, code, description) VALUES
    ('a3000000-0000-4000-8000-00000000001a', 'report.edit', 'Report edit'),
    ('a3000000-0000-4000-8000-00000000001b', 'report.admin', 'Report admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO role_permission (role_id, permission_id)
SELECT rp.role_id, p.id FROM role_permission rp JOIN permission v ON v.id = rp.permission_id AND v.code = 'report.view'
  CROSS JOIN permission p WHERE p.code IN ('report.edit', 'report.admin')
ON CONFLICT DO NOTHING;

-- ---- Insights is released as Beta: every plan already includes it (0048), so workspaces see it from today
UPDATE suite_component SET release = 'BETA', updated_at = now() WHERE key = 'insights' AND release = 'PLANNED';

-- ---- AI · Ask for a Report (patch 0055; apps/insights/assistant.py): the platform's providers and a workspace's own keys, each
--      workspace's prompts, the plan's allowance
CREATE TABLE IF NOT EXISTS ai_provider (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID REFERENCES tenant(id),                        -- NULL: the platform's row; else a workspace's own key, which wins
    provider            VARCHAR(12) NOT NULL,                              -- anthropic, openai
    api_key_enc         TEXT,                                              -- Fernet, apps/platform_ops/crypto.py; never shown again
    model_reports       VARCHAR(80),                                       -- the model offered as "best for reports"
    model_fast          VARCHAR(80),                                       -- the model offered as "fastest"
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at     TIMESTAMPTZ,
    last_check_ok       BOOLEAN,
    last_check_error    VARCHAR(300),
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_ai_provider_provider CHECK (provider IN ('anthropic', 'openai'))
);
ALTER TABLE ai_provider ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenant(id);          -- a table made by patch 0055's first shape
ALTER TABLE ai_provider DROP CONSTRAINT IF EXISTS ai_provider_provider_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_provider_platform ON ai_provider(provider) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_provider_tenant ON ai_provider(tenant_id, provider) WHERE tenant_id IS NOT NULL;
ALTER TABLE ai_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ai_provider_tenant ON ai_provider;
CREATE POLICY rls_ai_provider_tenant ON ai_provider USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);   -- the platform's rows are read by the platform login, which bypasses RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_provider TO cep_app;
GRANT ALL ON ai_provider TO cep_admin;

CREATE TABLE IF NOT EXISTS ai_prompt (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    user_id             UUID REFERENCES app_user(id),
    provider            VARCHAR(12) NOT NULL,
    model               VARCHAR(80) NOT NULL,
    kind                VARCHAR(10) NOT NULL DEFAULT 'report',             -- report (change and explain come later)
    prompt              TEXT NOT NULL,
    outcome             VARCHAR(10) NOT NULL,                              -- DRAFT, QUESTION, NO_FIELD, FAILED
    counted             BOOLEAN NOT NULL DEFAULT FALSE,                    -- only a draft counts against the month
    account             VARCHAR(10) NOT NULL DEFAULT 'PLATFORM',           -- PLATFORM: the platform's key (the plan's number applies); OWN: the workspace's key
    draft               JSONB,                                             -- {name, dataset, view, definition}
    reply               JSONB,                                             -- the question and its answers, or the message and suggestions
    detail              VARCHAR(300),                                      -- why it failed
    tokens_in           INTEGER NOT NULL DEFAULT 0,
    tokens_out          INTEGER NOT NULL DEFAULT 0,
    duration_ms         INTEGER,
    answer_to           UUID,                                              -- the question this prompt answers
    report_id           UUID REFERENCES report(id) ON DELETE SET NULL,     -- the report the draft became
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_ai_prompt_outcome CHECK (outcome IN ('DRAFT', 'QUESTION', 'NO_FIELD', 'FAILED')),
    CONSTRAINT ck_ai_prompt_account CHECK (account IN ('PLATFORM', 'OWN'))
);
ALTER TABLE ai_prompt ADD COLUMN IF NOT EXISTS account VARCHAR(10) NOT NULL DEFAULT 'PLATFORM';   -- likewise
ALTER TABLE ai_prompt DROP CONSTRAINT IF EXISTS ck_ai_prompt_account;
ALTER TABLE ai_prompt ADD CONSTRAINT ck_ai_prompt_account CHECK (account IN ('PLATFORM', 'OWN'));
ALTER TABLE ai_prompt ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;         -- AI Reports → Clear History: gone from the person's list, still counted (patch 0078)
CREATE INDEX IF NOT EXISTS ix_ai_prompt_tenant ON ai_prompt(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ai_prompt_user ON ai_prompt(user_id, created_at DESC);
ALTER TABLE ai_prompt ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ai_prompt_tenant ON ai_prompt;
CREATE POLICY rls_ai_prompt_tenant ON ai_prompt USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_prompt TO cep_app;
GRANT ALL ON ai_prompt TO cep_admin;

ALTER TABLE subscription_plan ADD COLUMN IF NOT EXISTS max_ai_prompts_per_month INTEGER;    -- AI drafts a workspace may ask for in a month; NULL = unlimited
COMMENT ON COLUMN subscription_plan.max_ai_prompts_per_month IS 'AI report drafts a workspace may ask for in a calendar month; NULL = unlimited';
UPDATE subscription_plan SET max_ai_prompts_per_month = CASE code WHEN 'STARTER' THEN 50 WHEN 'GROWTH' THEN 200 END
 WHERE max_ai_prompts_per_month IS NULL AND code IN ('STARTER', 'GROWTH');                   -- ENTERPRISE is unlimited

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('ai.default_model',   '""',   'STRING',  'Insights', 'The model preselected for people who have not chosen one, as provider:model (e.g. anthropic:claude-sonnet-5-5); empty means the first offered'),
    ('ai.explain_allowed', 'true', 'BOOLEAN', 'Insights', 'Whether Explain This Report may send a report''s totals (never personal data) to the model')
ON CONFLICT (key) DO NOTHING;

-- ---- Report Databases (patch 0056; apps/insights/databases.py, external.py): a workspace's own MySQL, PostgreSQL or ClickHouse (patch 0071) databases, read-only, and the
--      datasets it maps from their tables and views. A report may be built on a mapped dataset, so report.dataset_key no longer
--      references the platform's catalogue alone.
CREATE TABLE IF NOT EXISTS report_connection (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(100) NOT NULL,
    engine              VARCHAR(12) NOT NULL DEFAULT 'mysql80',           -- mysql57, mysql80, postgresql, clickhouse (over its HTTP interface)
    host                VARCHAR(200) NOT NULL,
    port                INTEGER NOT NULL DEFAULT 3306,
    database_name       VARCHAR(64) NOT NULL,
    schema_name         VARCHAR(64) NOT NULL DEFAULT 'public',            -- PostgreSQL: the schema the sources live in; MySQL: the database itself
    username            VARCHAR(100) NOT NULL,
    password_enc        TEXT NOT NULL,                                     -- Fernet, apps/platform_ops/crypto.py; never shown again
    ssl_mode            VARCHAR(10) NOT NULL DEFAULT 'REQUIRED',          -- REQUIRED, PREFERRED, OFF; ClickHouse: REQUIRED = HTTPS, OFF = HTTP
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, DISABLED
    last_tested_at      TIMESTAMPTZ,
    last_test_ok        BOOLEAN,
    last_test_error     VARCHAR(300),
    read_only           BOOLEAN,                                           -- the grants check: NULL until tested
    server_version      VARCHAR(40),
    server_timezone     VARCHAR(40),
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_connection_engine CHECK (engine IN ('mysql57', 'mysql80', 'postgresql', 'clickhouse')),
    CONSTRAINT ck_report_connection_ssl CHECK (ssl_mode IN ('REQUIRED', 'PREFERRED', 'OFF')),
    CONSTRAINT ck_report_connection_status CHECK (status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT ck_report_connection_port CHECK (port BETWEEN 1 AND 65535)
);
CREATE INDEX IF NOT EXISTS ix_report_connection_tenant ON report_connection(tenant_id, name);
ALTER TABLE report_connection DROP CONSTRAINT IF EXISTS ck_report_connection_engine;                                    -- patch 0071: ClickHouse
ALTER TABLE report_connection ADD CONSTRAINT ck_report_connection_engine CHECK (engine IN ('mysql57', 'mysql80', 'postgresql', 'clickhouse'));

CREATE TABLE IF NOT EXISTS report_dataset_custom (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    connection_id       UUID NOT NULL REFERENCES report_connection(id),
    key                 VARCHAR(40) NOT NULL,                              -- x_<slug>: what a report definition names; unique in the workspace
    label               VARCHAR(100) NOT NULL,
    description         VARCHAR(300),
    component_key       VARCHAR(20) NOT NULL DEFAULT 'cep' REFERENCES suite_component(key),
    source_name         VARCHAR(64) NOT NULL,                              -- the table or view
    primary_key         VARCHAR(60),                                       -- a field key, or none
    time_field          VARCHAR(60),                                       -- a date field key, or none
    fields              JSONB NOT NULL DEFAULT '[]',                       -- [{key, label, column, table?, type, role, aggregates, format, sensitivity}]; table: a join's alias (t1..), else the base
    joins               JSONB NOT NULL DEFAULT '[]',                       -- [{alias, table, type: left|inner, to: the alias joined to (t0 = the base), on: [[parent column, table column], ...]}]
    query_sql           TEXT,                                              -- a dataset from a query (patch 0058): the SELECT the engine wraps as FROM (…) AS t0; source_name is then 'query'
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',            -- ACTIVE, HIDDEN
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, key),
    CONSTRAINT ck_report_dataset_custom_key CHECK (key ~ '^x_[a-z0-9_]{1,37}$'),
    CONSTRAINT ck_report_dataset_custom_status CHECK (status IN ('ACTIVE', 'HIDDEN'))
);
ALTER TABLE report_dataset_custom ADD COLUMN IF NOT EXISTS joins JSONB NOT NULL DEFAULT '[]';     -- patch 0057 on a table made by 0056
ALTER TABLE report_dataset_custom ADD COLUMN IF NOT EXISTS query_sql TEXT;                          -- patch 0058
CREATE INDEX IF NOT EXISTS ix_report_dataset_custom_connection ON report_dataset_custom(connection_id);
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_connection', 'report_dataset_custom'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_connection, report_dataset_custom TO cep_app;
GRANT ALL ON report_connection, report_dataset_custom TO cep_admin;
ALTER TABLE report DROP CONSTRAINT IF EXISTS report_dataset_key_fkey;                     -- a report may be on a workspace's own dataset

-- ---- uploaded files (patch 0063): a CSV or Excel file the workspace uploaded, its rows read by Insights as a dataset (upl_<slug>)
CREATE TABLE IF NOT EXISTS report_upload (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    key                 VARCHAR(40) NOT NULL,                              -- upl_<slug>: what a report definition names; unique in the workspace
    name                VARCHAR(100) NOT NULL,
    description         VARCHAR(300),
    file_name           VARCHAR(200) NOT NULL,
    file_kind           VARCHAR(4) NOT NULL,                               -- csv, xlsx
    columns             JSONB NOT NULL DEFAULT '[]',                       -- [{key, label, column: c1.., source: the file's header, type, role, inferred}]
    row_count           INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(10) NOT NULL DEFAULT 'DRAFT',              -- DRAFT (read, not yet reviewed), READY (a dataset)
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    replaced_at         TIMESTAMPTZ,
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_upload_key CHECK (key ~ '^upl_[a-z0-9_]{1,36}$'),
    CONSTRAINT ck_report_upload_kind CHECK (file_kind IN ('csv', 'xlsx')),
    CONSTRAINT ck_report_upload_status CHECK (status IN ('DRAFT', 'READY'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_upload_key ON report_upload(tenant_id, key) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS report_upload_row (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    upload_id           UUID NOT NULL REFERENCES report_upload(id) ON DELETE CASCADE,
    row_no              INTEGER NOT NULL,
    data                JSONB NOT NULL,                                    -- {"c1": value, ...}: numbers, ISO dates, true/false, text; an empty cell is left out
    PRIMARY KEY (upload_id, row_no)
);
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_upload', 'report_upload_row'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_upload, report_upload_row TO cep_app;
GRANT ALL ON report_upload, report_upload_row TO cep_admin;
GRANT SELECT ON report_upload_row TO cep_reporting;                        -- the engine reads the rows as the reporting role, the workspace's only (RLS)

-- ---- Key Influencers and Decomposition Tree (patch 0064): the two views PR 157 added fit the report's view type
ALTER TABLE report ALTER COLUMN view_type TYPE VARCHAR(20);
ALTER TABLE report_version ALTER COLUMN view_type TYPE VARCHAR(20);
ALTER TABLE report DROP CONSTRAINT IF EXISTS ck_report_view_type;
ALTER TABLE report ADD CONSTRAINT ck_report_view_type CHECK (view_type IN ('grid', 'chart', 'pivot', 'hierarchy', 'influencers', 'decomposition'));

-- ---- shared formulas (patch 0065): measures and calculated columns saved on a dataset, read by every report on it
-- (apps/insights/dataset_formulas.py); certified ones are vouched for by a report administrator
CREATE TABLE IF NOT EXISTS report_dataset_formula (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    dataset_key         VARCHAR(60) NOT NULL,                              -- a platform dataset, a workspace database's (x_..) or an uploaded file's (upl_..)
    key                 VARCHAR(44) NOT NULL,                              -- f_<slug>: what report definitions name
    label               VARCHAR(60) NOT NULL,
    description         VARCHAR(300),
    kind                VARCHAR(10) NOT NULL,                              -- formula (one value per row), measure (over a group's rows)
    expression          TEXT NOT NULL,                                     -- the formula language (apps/insights/formula.py)
    type                VARCHAR(10) NOT NULL,                              -- what it works out: number, string, boolean, date, datetime
    role                VARCHAR(10),                                       -- a formula: measure (adds up) or dimension (groups)
    format              VARCHAR(10),                                       -- integer, decimal, money, percent
    sensitivity         VARCHAR(10) NOT NULL DEFAULT 'NORMAL',             -- PII when it reads personal data
    certified           BOOLEAN NOT NULL DEFAULT FALSE,
    certified_by        UUID REFERENCES app_user(id) ON DELETE SET NULL,
    certified_at        TIMESTAMPTZ,
    sort_order          INTEGER NOT NULL DEFAULT 0,                        -- a formula reads the ones before it
    created_by          UUID REFERENCES app_user(id) ON DELETE SET NULL,
    updated_by          UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ck_report_dataset_formula_key CHECK (key ~ '^f_[a-z0-9_]{1,42}$'),
    CONSTRAINT ck_report_dataset_formula_kind CHECK (kind IN ('formula', 'measure')),
    CONSTRAINT ck_report_dataset_formula_role CHECK (role IS NULL OR role IN ('measure', 'dimension')),
    CONSTRAINT ck_report_dataset_formula_sensitivity CHECK (sensitivity IN ('NORMAL', 'PII'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_report_dataset_formula_key ON report_dataset_formula(tenant_id, dataset_key, key) WHERE deleted_at IS NULL;
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_dataset_formula'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_dataset_formula TO cep_app;
GRANT ALL ON report_dataset_formula TO cep_admin;

-- ---- security (patch 0066): what the check-security job and Check Now found on this server (apps/platform_ops/security.py):
-- package advisories from OSV.dev for the installed Python packages and the deployed frontend's npm packages, and the server's
-- settings and the headers its site sends. Back-office → Security.
CREATE TABLE IF NOT EXISTS security_check (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host                VARCHAR(200) NOT NULL,                           -- the server that checked itself
    trigger             VARCHAR(10) NOT NULL DEFAULT 'SCHEDULE',         -- SCHEDULE | MANUAL
    triggered_by        UUID REFERENCES app_user(id) ON DELETE SET NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at         TIMESTAMPTZ,
    status              VARCHAR(10) NOT NULL DEFAULT 'RUNNING',          -- RUNNING | DONE | FAILED
    python_packages     INTEGER NOT NULL DEFAULT 0,
    npm_packages        INTEGER NOT NULL DEFAULT 0,
    settings_checked    INTEGER NOT NULL DEFAULT 0,
    found               JSONB NOT NULL DEFAULT '{}'::jsonb,              -- open items by severity after the check
    fixed               JSONB NOT NULL DEFAULT '[]'::jsonb,              -- the items this check found fixed
    error               VARCHAR(500),
    CONSTRAINT ck_security_check_trigger CHECK (trigger IN ('SCHEDULE', 'MANUAL')),
    CONSTRAINT ck_security_check_status CHECK (status IN ('RUNNING', 'DONE', 'FAILED'))
);
CREATE INDEX IF NOT EXISTS ix_security_check_started ON security_check(host, started_at DESC);
COMMENT ON TABLE security_check IS 'Each run of the security check on a server: what it looked at, what it found open and what it found fixed';

CREATE TABLE IF NOT EXISTS security_finding (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    host                VARCHAR(200) NOT NULL,
    fingerprint         VARCHAR(200) NOT NULL,                           -- kind:ecosystem:item, one row per thing to fix
    kind                VARCHAR(10) NOT NULL,                            -- PACKAGE | SETTING | HEADER | DATABASE | ACCOUNT | MAIL (patch 0067)
    ecosystem           VARCHAR(10),                                     -- PyPI | npm (packages)
    item                VARCHAR(200) NOT NULL,                           -- the package, or the setting's key
    title               VARCHAR(200) NOT NULL,
    detail              VARCHAR(500),
    installed           VARCHAR(100),                                    -- the version or the value now
    fixed_in            VARCHAR(100),                                    -- the version or the value that fixes it
    severity            VARCHAR(10) NOT NULL,                            -- CRITICAL | HIGH | MEDIUM | LOW
    advisories          JSONB NOT NULL DEFAULT '[]'::jsonb,              -- [{id, url, summary}]
    status              VARCHAR(10) NOT NULL DEFAULT 'OPEN',             -- OPEN | FIXED | ACCEPTED
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
    fixed_at            TIMESTAMPTZ,
    accepted_by         UUID REFERENCES app_user(id) ON DELETE SET NULL,
    accepted_at         TIMESTAMPTZ,
    accept_reason       VARCHAR(500),
    review_on           DATE,                                            -- an accepted item opens again on this day
    accepted_advisories JSONB NOT NULL DEFAULT '[]'::jsonb,              -- the advisory ids accepted: a newer one opens the item again
    row_version         INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ux_security_finding UNIQUE (host, fingerprint),
    CONSTRAINT ck_security_finding_kind CHECK (kind IN ('PACKAGE', 'SETTING', 'HEADER', 'DATABASE', 'ACCOUNT', 'MAIL')),
    CONSTRAINT ck_security_finding_severity CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    CONSTRAINT ck_security_finding_status CHECK (status IN ('OPEN', 'FIXED', 'ACCEPTED'))
);
CREATE INDEX IF NOT EXISTS ix_security_finding_open ON security_finding(host, status, severity);
COMMENT ON TABLE security_finding IS 'What the security check found on a server, kept across checks: open, fixed (with when) or accepted (with who, why and until when)';

-- patch 0067: the data checks (apps/platform_ops/security_data.py): workspace isolation, accounts and keys, sending domains
ALTER TABLE security_finding DROP CONSTRAINT IF EXISTS ck_security_finding_kind;
ALTER TABLE security_finding ADD CONSTRAINT ck_security_finding_kind CHECK (kind IN ('PACKAGE', 'SETTING', 'HEADER', 'DATABASE', 'ACCOUNT', 'MAIL'));

GRANT SELECT, INSERT, UPDATE ON security_check, security_finding TO cep_app;
GRANT ALL ON security_check, security_finding TO cep_admin;

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('security.site_address', '""', 'STRING', 'Security', 'The public address of this server''s app (https://…), whose headers the security check reads; empty: headers not checked')
ON CONFLICT (key) DO NOTHING;

-- ---- sending domains (patch 0068): SPF, DMARC and DKIM of the domains a workspace's email senders use, looked up daily by the
-- check-sending-domains job and on Check Now (apps/delivery/domain_health.py); the DKIM selector is the workspace's to give
CREATE TABLE IF NOT EXISTS sending_domain (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    domain              CITEXT NOT NULL,
    dkim_selector       VARCHAR(63),                                       -- as the engine shows it, e.g. postal-Xa71Qd; NULL: DKIM not checked
    result              JSONB NOT NULL DEFAULT '{}',                       -- evaluate(): lookup, spf, dmarc, dkim (status, found, publish), changes
    checked_at          TIMESTAMPTZ,
    updated_by          UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, domain)
);
COMMENT ON TABLE sending_domain IS 'The DNS records inboxes read before they trust a workspace''s mail (SPF, DMARC, DKIM), as last looked up; never changed by C360';
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['sending_domain'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON sending_domain TO cep_app;
GRANT ALL ON sending_domain TO cep_admin;

-- ---- engine health (patch 0069): the latest result of the check-engine-health job per sending engine (apps/delivery/health.py):
-- callbacks, refused calls, API speed, bounces or text failures, receipts and the daily Check. The workspace's Sending Engines
-- page and the back-office's Engine Health page read it; the alert evaluator raises one alert per engine and check from it.
CREATE TABLE IF NOT EXISTS delivery_provider_health (
    delivery_provider_id UUID PRIMARY KEY REFERENCES delivery_provider(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    status              VARCHAR(10) NOT NULL,                            -- HEALTHY | ATTENTION | FAILING | QUIET
    summary             VARCHAR(300),                                    -- the one line shown under the tag
    checks              JSONB NOT NULL DEFAULT '[]'::jsonb,              -- [{key, label, state, value, line, summary, detail, standing}]
    figures             JSONB NOT NULL DEFAULT '{}'::jsonb,              -- the counts behind the checks
    checked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_since        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_delivery_provider_health_status CHECK (status IN ('HEALTHY', 'ATTENTION', 'FAILING', 'QUIET'))
);
CREATE INDEX IF NOT EXISTS ix_delivery_provider_health_tenant ON delivery_provider_health(tenant_id);
COMMENT ON TABLE delivery_provider_health IS 'The latest Engine Health result per sending engine, written every 10 minutes by the check-engine-health job';

ALTER TABLE delivery_provider_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_provider_health FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_delivery_provider_health_tenant ON delivery_provider_health;
CREATE POLICY rls_delivery_provider_health_tenant ON delivery_provider_health
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON delivery_provider_health TO cep_app;     -- the job writes in each workspace's own scope
GRANT ALL ON delivery_provider_health TO cep_admin;

INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('engine_health.callback_silence_minutes', '60',   'INTEGER', 'Engine health', 'Failing when an engine took messages but has not called back for this many minutes'),
    ('engine_health.rejection_rate_pct',       '1',    'DECIMAL', 'Engine health', 'Attention when more than this share of an engine''s calls in the last hour were refused or failed (any 401 or 403 is Failing at once)'),
    ('engine_health.p95_ms',                   '5000', 'INTEGER', 'Engine health', 'Attention when 5% of an engine''s calls in the last hour took longer than this many milliseconds'),
    ('engine_health.hard_bounce_pct',          '2',    'DECIMAL', 'Engine health', 'Attention above this share of hard bounces in the last day''s email (Failing at twice it)'),
    ('engine_health.complaint_pct',            '0.1',  'DECIMAL', 'Engine health', 'Attention above this share of spam complaints in the last day''s email (Failing at twice it)'),
    ('engine_health.sms_failure_pct',          '5',    'DECIMAL', 'Engine health', 'Attention above this share of failed texts among the last day''s delivery receipts (Failing at twice it)'),
    ('engine_health.receipt_wait_minutes',     '15',   'INTEGER', 'Engine health', 'A text without a delivery receipt this many minutes after it was sent counts as missing'),
    ('engine_health.missing_receipt_pct',      '1',    'DECIMAL', 'Engine health', 'Attention when more than this share of the last two hours'' texts have no delivery receipt'),
    ('engine_health.min_sample',               '50',   'INTEGER', 'Engine health', 'A rate is judged only from this many messages or calls in its window')
ON CONFLICT (key) DO NOTHING;

-- ---- UTM tracking (patch 0070): the links of email and text campaigns carry UTM tags (apps/delivery/utm.py). The workspace's
-- settings live in tenant.settings.utm; a campaign's own choices (tagging on or off, its campaign name and tactic as sent, its
-- link labels) in campaign_link_tracking, saved on their own so the campaign's row_version is not touched. A text's links
-- become short links (tracking_link, one per campaign and address) that open the tagged page and count clicks.
CREATE TABLE IF NOT EXISTS campaign_link_tracking (
    campaign_id         UUID PRIMARY KEY REFERENCES campaign(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,                     -- FALSE: this campaign's links go out as written
    overrides           JSONB NOT NULL DEFAULT '{}',                       -- {utm_campaign, utm_marketing_tactic}: this campaign's own values
    labels              JSONB NOT NULL DEFAULT '{}',                       -- {"position|address as written": label}: utm_content per link
    updated_by          UUID REFERENCES app_user(id) ON DELETE SET NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_campaign_link_tracking_objects CHECK (jsonb_typeof(overrides) = 'object' AND jsonb_typeof(labels) = 'object')
);
COMMENT ON TABLE campaign_link_tracking IS 'A campaign''s own link tracking choices; no row = the workspace''s UTM settings as they are';
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['campaign_link_tracking'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_link_tracking TO cep_app;
GRANT ALL ON campaign_link_tracking TO cep_admin;
ALTER TABLE tracking_link ADD COLUMN IF NOT EXISTS clicks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracking_link ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tracking_link_campaign_target ON tracking_link(tenant_id, campaign_id, md5(target_url)) WHERE campaign_id IS NOT NULL;
INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('links.short_base_url', '""', 'STRING', 'Platform', 'Where text campaigns'' short links point, e.g. https://go.example.com (served by the API under /api/v1/l/); empty: the public API address')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 0072: what an installation needs without the sample data (2026-10-22). A production database is built from the layers
-- alone (database/production/build_production_db.sh), so everything the code relies on is here rather than in
-- CEP_Seed_Data.sql: the core permissions, which until now only the sample data inserted (a workspace onboarded on a
-- database without it got nearly empty roles); the Insights plan, the reports engine without Engagement; and the record of
-- the patches applied to this database (database/apply_patch.sh writes it; a database built from the layers has them all).
-- -------------------------------------------------------------------------------------
INSERT INTO permission (id, code, description) VALUES
    ('a3000000-0000-4000-8000-000000000001', 'campaign.view', 'Campaign view'),
    ('a3000000-0000-4000-8000-000000000002', 'campaign.edit', 'Campaign edit'),
    ('a3000000-0000-4000-8000-000000000003', 'campaign.publish', 'Campaign publish'),
    ('a3000000-0000-4000-8000-000000000004', 'journey.view', 'Journey view'),
    ('a3000000-0000-4000-8000-000000000005', 'journey.edit', 'Journey edit'),
    ('a3000000-0000-4000-8000-000000000006', 'journey.activate', 'Journey activate'),
    ('a3000000-0000-4000-8000-000000000007', 'template.view', 'Template view'),
    ('a3000000-0000-4000-8000-000000000008', 'template.edit', 'Template edit'),
    ('a3000000-0000-4000-8000-000000000009', 'list.view', 'List view'),
    ('a3000000-0000-4000-8000-000000000010', 'list.edit', 'List edit'),
    ('a3000000-0000-4000-8000-000000000011', 'list.import', 'List import'),
    ('a3000000-0000-4000-8000-000000000012', 'governance.edit', 'Governance edit'),
    ('a3000000-0000-4000-8000-000000000013', 'provider.edit', 'Provider edit'),
    ('a3000000-0000-4000-8000-000000000014', 'report.view', 'Report view'),
    ('a3000000-0000-4000-8000-000000000015', 'consent.edit', 'Consent edit'),
    ('a3000000-0000-4000-8000-000000000016', 'user.admin', 'User admin')
ON CONFLICT (code) DO NOTHING;

INSERT INTO subscription_plan (code, name, default_isolation_mode, max_users, features) VALUES
    ('INSIGHTS', 'Insights', 'SHARED', NULL, '{"journeys": false, "ereceipt": false, "ab_testing": false, "custom_domain": false}')
ON CONFLICT (code) DO NOTHING;
INSERT INTO plan_component (plan_id, component_key)
SELECT id, 'insights' FROM subscription_plan WHERE code = 'INSIGHTS'
ON CONFLICT (plan_id, component_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS schema_patch (
    name                VARCHAR(100) PRIMARY KEY,                         -- the file in database/patches, e.g. 0072_production_reference.sql
    applied_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by          TEXT NOT NULL DEFAULT current_user,
    how                 VARCHAR(10) NOT NULL DEFAULT 'PATCH',            -- PATCH (apply_patch.sh) or BUILD (part of the layers a new database was built from)
    CONSTRAINT ck_schema_patch_how CHECK (how IN ('PATCH', 'BUILD'))
);
GRANT SELECT ON schema_patch TO cep_admin;

-- -------------------------------------------------------------------------------------
-- 0073: copying a workspace into another installation (2026-10-22). EXPORT_FOR_COPY writes a file a second database can
-- load (apps/platform_ops/workspace_copy.py); IMPORT is the record of such a load on the receiving side.
-- -------------------------------------------------------------------------------------
ALTER TABLE tenant_operation DROP CONSTRAINT IF EXISTS ck_tenant_operation_operation;
ALTER TABLE tenant_operation ADD CONSTRAINT ck_tenant_operation_operation
    CHECK (operation IN ('EXPORT', 'EXPORT_FOR_COPY', 'IMPORT', 'MOVE_TO_DEDICATED', 'PURGE_SOURCE', 'OFFBOARD'));

-- -------------------------------------------------------------------------------------
-- 0074: how reports treat a Report Database, and its pinned tables (2026-10-23). A preset (Standard follows the workspace's limits; Large or Slow
-- 60 s and 2 reports at once; Live Production Database 60 s and 1) or Custom with its own time limit and reports at once,
-- set by workspace administrators (apps/insights/connection_limits.py). The next report uses them; nothing restarts.
-- -------------------------------------------------------------------------------------
ALTER TABLE report_connection ADD COLUMN IF NOT EXISTS limit_profile VARCHAR(10) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE report_connection ADD COLUMN IF NOT EXISTS query_timeout_s INTEGER;
ALTER TABLE report_connection ADD COLUMN IF NOT EXISTS max_concurrent SMALLINT;
-- the tables pinned to the top of Map a Dataset's list: the only thing kept about the customer's database (names are read live)
ALTER TABLE report_connection ADD COLUMN IF NOT EXISTS pinned_tables JSONB NOT NULL DEFAULT '[]';
ALTER TABLE report_connection DROP CONSTRAINT IF EXISTS ck_report_connection_limits;
ALTER TABLE report_connection ADD CONSTRAINT ck_report_connection_limits CHECK (
    limit_profile IN ('STANDARD', 'LARGE', 'LIVE', 'CUSTOM')
    AND (query_timeout_s IS NULL OR query_timeout_s BETWEEN 5 AND 110)
    AND (max_concurrent IS NULL OR max_concurrent BETWEEN 1 AND 4));

-- -------------------------------------------------------------------------------------
-- 0075: the component a report is listed under (2026-10-23), chosen when it is made (New Report, Ask for a Report, a report from a
-- query) and changed by whoever may edit it. Empty = Automatic: its dataset's component, as before. Any row of suite_component, so a
-- component added to the suite later is offered with no change here.
-- -------------------------------------------------------------------------------------
ALTER TABLE report ADD COLUMN IF NOT EXISTS component_key VARCHAR(20) REFERENCES suite_component(key);

-- -------------------------------------------------------------------------------------
-- 0076: whether a Report Database's account must be read-only (2026-10-23), a global parameter (Back-office -> Global
-- parameters -> Insights). Yes (as before): an account that can write is refused until it holds SELECT only. No: it is used,
-- with a warning on its card; every C360 session on it is still read-only and runs SELECT only (apps/insights/external.py).
-- -------------------------------------------------------------------------------------
INSERT INTO platform_setting (key, value, value_type, category, description) VALUES
    ('insights.report_db_read_only_required', 'true', 'BOOLEAN', 'Insights',
     'Whether a Report Database''s account must hold SELECT only. On: an account that can write is refused until it is fixed. Off: it is used, with a warning; C360 still opens every session on it read-only and runs SELECT only')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 0077: Switch Workspace (2026-10-23, docs/mockups/switch-workspace.html option B). A platform administrator enters another
-- workspace as themselves, with full rights, giving a reason (apps/platform_ops/visits.py). One row per visit, written by the
-- platform; the workspace's administrators read theirs (Settings -> Security -> Platform Visits), the back-office all of them.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_visit (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),             -- the workspace visited
    staff_user_id       UUID NOT NULL REFERENCES app_user(id),           -- the platform administrator, as themselves
    staff_name          VARCHAR(200),                                    -- their name at the time (RLS hides their row from the workspace)
    home_tenant_id      UUID REFERENCES tenant(id),                      -- where Back to Platform returns
    reason              TEXT NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ,                                     -- Back to Platform, or signing out
    ip_address          INET,
    writes              INTEGER NOT NULL DEFAULT 0,                      -- changes made during the visit
    CONSTRAINT ck_platform_visit_reason CHECK (length(btrim(reason)) >= 5)
);
COMMENT ON TABLE platform_visit IS 'Every time a platform administrator entered a workspace as themselves (Switch Workspace): who, why, from when to when. Visible to the workspace.';
CREATE INDEX IF NOT EXISTS ix_platform_visit_tenant ON platform_visit(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_platform_visit_staff ON platform_visit(staff_user_id, started_at DESC);
GRANT ALL ON platform_visit TO cep_admin;
GRANT SELECT ON platform_visit TO cep_app;
REVOKE INSERT, UPDATE, DELETE ON platform_visit FROM cep_app;                -- the workspace reads its visits; only the platform writes them

-- ---- base reports (patch 0079): the base packs a workspace added from the platform's catalogue (apps/insights/base_reports.py), as
-- its own copies, and what each addition made: the dialog shows which version a workspace has, the back-office which workspaces
CREATE TABLE IF NOT EXISTS report_base_install (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    pack_key            VARCHAR(60) NOT NULL,                              -- apps/insights/base_packs: email-campaigns
    version             INTEGER NOT NULL,
    connection_id       UUID,                                              -- the workspace database it reads (report_connection)
    options             JSONB NOT NULL DEFAULT '{}'::jsonb,                -- what the person picked: databases, campaign names, words left out
    folder_id           UUID,
    made                JSONB NOT NULL DEFAULT '{}'::jsonb,                -- {datasets: [key], reports: [id], dashboards: [id]}
    created_by          UUID REFERENCES app_user(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_report_base_install_version CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS ix_report_base_install_tenant ON report_base_install(tenant_id, pack_key, created_at DESC);
DO $$ DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['report_base_install'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS rls_%I_tenant ON %I', t, t);
        EXECUTE format('CREATE POLICY rls_%I_tenant ON %I USING (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid) '
                       'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant'', true), '''')::uuid)', t, t);
    END LOOP;
END $$;
GRANT SELECT, INSERT ON report_base_install TO cep_app;
GRANT ALL ON report_base_install TO cep_admin;

-- Partitions are reached only through their parent, so row-level security on the parent cannot be side-stepped by naming a
-- tenant's partition. An earlier layer's GRANT ... ON ALL TABLES, or a partition made outside fn_provision_tenant (the sample
-- data's history months), would give the application role direct access again; this layer runs last and with every patch.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relispartition AND c.relkind IN ('r', 'p') AND has_table_privilege('cep_app', c.oid, 'SELECT') LOOP
        EXECUTE format('REVOKE ALL ON %I FROM cep_app', r.relname);
    END LOOP;
END $$;

-- =====================================================================================
-- End of platform operations layer.
-- =====================================================================================
