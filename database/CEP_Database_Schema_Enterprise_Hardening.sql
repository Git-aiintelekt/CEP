-- =====================================================================================
-- AI-InteleKt CEP — ENTERPRISE HARDENING LAYER
-- Target: PostgreSQL 18+   ·   Run AFTER CEP_Database_Schema.sql
--
-- This file is intentionally separate from the MVP schema. The MVP DDL stays exactly as
-- baselined against BRD v0.9 (4-week scope); everything here is an additive enterprise
-- control that can be applied, reviewed, or deferred independently:
--
--   1. Audit columns            created_by / updated_by / updated_at, soft delete, optimistic locking
--   2. Row-touch trigger        maintains updated_at + row_version automatically
--   3. CHECK constraints        every status / enum column is a closed set at the database
--   4. Row-level security       tenant isolation enforced by PostgreSQL, not only by the ORM
--   5. Change history           definition_audit_log + generic trigger on every definition table
--   6. Provider / sender / media   delivery_provider, sender_profile, media_asset (+ template link)
--   7. Dead-letter persistence  permanently-failed sends kept for operator review
--   8. PII classification       COMMENT ON COLUMN tags for data-protection tooling
--   9. Design-standard pass     COMMENT ON TABLE for every table, reference_code catalogue of every closed
--                               value set, an index on every foreign-key column, natural-key uniqueness
--   (Partition provisioning / retention / tenant migration live in CEP_Database_Schema_SaaS_Tenancy.sql)
--
-- Session settings the application must set per request (Django middleware / Celery task):
--   SET LOCAL app.current_tenant = '<tenant uuid>';
--   SET LOCAL app.current_user_id   = '<app_user uuid>';   -- optional; used for updated_by / changed_by
-- =====================================================================================

-- =====================================================================================
-- 1. AUDIT COLUMNS
--    Full audit (definition tables): created_by, updated_by, updated_at, deleted_at, row_version
--    Light audit (system-managed rows): updated_by, updated_at, row_version
--    Append-only high-volume tables and synced C360 copies are intentionally untouched.
-- =====================================================================================

ALTER TABLE tenant
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_user
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE role
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contact_list
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE template_master
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE personalization_tag
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receipt_presentation_model
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receipt_field_configuration
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign_run_variant
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign_target
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey_entry_rule
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey_node
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey_connection
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE communication_governance_policy
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE governance_exemption
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE campaign_run
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign_list
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey_version
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE journey_enrollment
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE consent_suppression
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE campaign_actual
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contact_list_import
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contact_point_status
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES app_user(id),
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

-- Soft-deleted rows drop out of the hot list indexes:
CREATE INDEX ix_campaign_live ON campaign(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_journey_live ON journey(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_contact_list_live ON contact_list(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_template_master_live ON template_master(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_communication_governance_policy_live ON communication_governance_policy(tenant_id, is_active) WHERE deleted_at IS NULL;

-- =====================================================================================
-- 2. ROW-TOUCH TRIGGER — updated_at / row_version / updated_by maintained by the database
--    Optimistic locking: clients send the row_version they read; UPDATE ... WHERE row_version = :v
-- =====================================================================================

-- fn: BEFORE UPDATE trigger — stamps updated_at, increments row_version, fills updated_by from session setting
CREATE OR REPLACE FUNCTION fn_touch_row()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at  := now();
    NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
    IF NEW.updated_by IS NULL OR NEW.updated_by = OLD.updated_by THEN
        NEW.updated_by := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    END IF;
    RETURN NEW;
END $$;

-- fn: BEFORE UPDATE trigger for tables that carry updated_at only (no updated_by / row_version)
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_tenant_touch BEFORE UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_app_user_touch BEFORE UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_role_touch BEFORE UPDATE ON role FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_contact_list_touch BEFORE UPDATE ON contact_list FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_template_master_touch BEFORE UPDATE ON template_master FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_personalization_tag_touch BEFORE UPDATE ON personalization_tag FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_receipt_presentation_model_touch BEFORE UPDATE ON receipt_presentation_model FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_receipt_field_configuration_touch BEFORE UPDATE ON receipt_field_configuration FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_touch BEFORE UPDATE ON campaign FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_run_variant_touch BEFORE UPDATE ON campaign_run_variant FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_target_touch BEFORE UPDATE ON campaign_target FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_touch BEFORE UPDATE ON journey FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_entry_rule_touch BEFORE UPDATE ON journey_entry_rule FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_node_touch BEFORE UPDATE ON journey_node FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_connection_touch BEFORE UPDATE ON journey_connection FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_communication_governance_policy_touch BEFORE UPDATE ON communication_governance_policy FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_governance_exemption_touch BEFORE UPDATE ON governance_exemption FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_run_touch BEFORE UPDATE ON campaign_run FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_list_touch BEFORE UPDATE ON campaign_list FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_version_touch BEFORE UPDATE ON journey_version FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_enrollment_touch BEFORE UPDATE ON journey_enrollment FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_consent_suppression_touch BEFORE UPDATE ON consent_suppression FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_campaign_actual_touch BEFORE UPDATE ON campaign_actual FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_contact_list_import_touch BEFORE UPDATE ON contact_list_import FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_contact_point_status_touch BEFORE UPDATE ON contact_point_status FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_journey_customer_state_touch BEFORE UPDATE ON journey_customer_state FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- =====================================================================================
-- 6. DELIVERY PROVIDER · SENDER PROFILE · MEDIA ASSET
--    Delivery stays behind provider adapters (BRD Appendix B, Multi-ESP guardrail); secrets are
--    NEVER stored here — secret_ref names a key in the vault / environment.
-- =====================================================================================

CREATE TABLE delivery_provider (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    provider_type       VARCHAR(20) NOT NULL,            -- POSTAL, DIGIVIZE, OTHER_ESP, OTHER_SMS
    channel             VARCHAR(20) NOT NULL,            -- EMAIL, SMS, MMS
    name                VARCHAR(150) NOT NULL,
    config              JSONB NOT NULL DEFAULT '{}',     -- non-secret settings: endpoint, webhook path, sending domain
    secret_ref          VARCHAR(200),                    -- vault key for API credentials; never the credential itself
    rate_limit_per_minute INTEGER,                        -- provider throughput cap honoured by workers
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX ux_delivery_provider_default ON delivery_provider(tenant_id, channel) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE sender_profile (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    delivery_provider_id UUID NOT NULL REFERENCES delivery_provider(id),
    channel             VARCHAR(20) NOT NULL,            -- EMAIL, SMS, MMS
    display_name        VARCHAR(150) NOT NULL,           -- "Citi Trends Rewards"
    from_address        CITEXT,                          -- email channel
    reply_to_address    CITEXT,
    sender_id           VARCHAR(30),                     -- SMS/MMS short code or long number
    verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, VERIFIED, FAILED (SPF/DKIM/10DLC)
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_sender_profile_tenant ON sender_profile(tenant_id, channel);
ALTER TABLE campaign ADD COLUMN IF NOT EXISTS sender_profile_id UUID REFERENCES sender_profile(id);

CREATE TABLE media_asset (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    file_name           VARCHAR(255) NOT NULL,
    mime_type           VARCHAR(100) NOT NULL,
    byte_size           BIGINT NOT NULL,
    storage_key         VARCHAR(500) NOT NULL,           -- object-store key (S3/GCS/Azure)
    public_url          TEXT,                            -- CDN URL used in rendered content / MMS media_url
    checksum_sha256     CHAR(64) NOT NULL,               -- de-duplication and integrity
    width_px            INTEGER,
    height_px           INTEGER,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, checksum_sha256)
);

CREATE TABLE template_media_asset (          -- where is this asset used? (blocks deletion of in-use media)
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    media_asset_id      UUID NOT NULL REFERENCES media_asset(id),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (template_id, media_asset_id)
);

-- =====================================================================================
-- 7. DEAD-LETTER PERSISTENCE — permanently failed sends survive the Celery queue for review
-- =====================================================================================

CREATE TABLE dead_letter_message (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    queue_name          VARCHAR(80) NOT NULL,             -- marketing_email, sms, transactional, journey, webhook...
    task_name           VARCHAR(200) NOT NULL,
    campaign_run_id     UUID,
    party_id            VARCHAR(60),
    channel             VARCHAR(20),                      -- EMAIL, SMS, MMS
    idempotency_key     VARCHAR(200),
    payload             JSONB NOT NULL,
    error_class         VARCHAR(200) NOT NULL,
    error_message       TEXT,
    attempts            INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, RETRIED, DISCARDED
    resolved_by         UUID,
    resolved_at         TIMESTAMPTZ,
    first_failed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_failed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, first_failed_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (first_failed_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_dead_letter_open ON dead_letter_message(tenant_id, queue_name) WHERE status = 'OPEN';
CREATE INDEX ix_dead_letter_run ON dead_letter_message(campaign_run_id);

-- =====================================================================================
-- 5. DEFINITION CHANGE HISTORY — who changed which campaign / journey / template / policy, when, from what to what
-- =====================================================================================

CREATE TABLE definition_audit_log (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    entity_table        VARCHAR(63) NOT NULL,
    entity_id           TEXT NOT NULL,
    action              VARCHAR(10) NOT NULL,             -- INSERT, UPDATE, DELETE
    changed_by          UUID,                             -- app.current_user_id session setting
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_columns     TEXT[],                           -- UPDATE only
    old_row             JSONB,
    new_row             JSONB,
    PRIMARY KEY (id, tenant_id, changed_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (changed_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_definition_audit_entity ON definition_audit_log(entity_table, entity_id, changed_at);
CREATE INDEX ix_definition_audit_tenant ON definition_audit_log(tenant_id, changed_at);

-- fn: AFTER INSERT/UPDATE/DELETE trigger — writes before/after JSON of the row to definition_audit_log
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

CREATE TRIGGER trg_app_user_audit AFTER INSERT OR UPDATE OR DELETE ON app_user FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_role_audit AFTER INSERT OR UPDATE OR DELETE ON role FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_contact_list_audit AFTER INSERT OR UPDATE OR DELETE ON contact_list FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_template_master_audit AFTER INSERT OR UPDATE OR DELETE ON template_master FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_template_design_state_audit AFTER INSERT OR UPDATE OR DELETE ON template_design_state FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_receipt_field_configuration_audit AFTER INSERT OR UPDATE OR DELETE ON receipt_field_configuration FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_campaign_audit AFTER INSERT OR UPDATE OR DELETE ON campaign FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_campaign_run_audit AFTER INSERT OR UPDATE OR DELETE ON campaign_run FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_campaign_target_audit AFTER INSERT OR UPDATE OR DELETE ON campaign_target FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_journey_audit AFTER INSERT OR UPDATE OR DELETE ON journey FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_journey_version_audit AFTER INSERT OR UPDATE OR DELETE ON journey_version FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_journey_entry_rule_audit AFTER INSERT OR UPDATE OR DELETE ON journey_entry_rule FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_journey_node_audit AFTER INSERT OR UPDATE OR DELETE ON journey_node FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_journey_connection_audit AFTER INSERT OR UPDATE OR DELETE ON journey_connection FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_communication_governance_policy_audit AFTER INSERT OR UPDATE OR DELETE ON communication_governance_policy FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_governance_exemption_audit AFTER INSERT OR UPDATE OR DELETE ON governance_exemption FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_consent_suppression_audit AFTER INSERT OR UPDATE OR DELETE ON consent_suppression FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_delivery_provider_audit AFTER INSERT OR UPDATE OR DELETE ON delivery_provider FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_sender_profile_audit AFTER INSERT OR UPDATE OR DELETE ON sender_profile FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_personalization_tag_audit AFTER INSERT OR UPDATE OR DELETE ON personalization_tag FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_contact_point_status_audit AFTER INSERT OR UPDATE OR DELETE ON contact_point_status FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();

-- =====================================================================================
-- 3. CHECK CONSTRAINTS — closed value sets and business rules enforced at the database.
--    Django models mirror these as `choices`; the database is the last line of defence.
-- =====================================================================================

ALTER TABLE tenant ADD CONSTRAINT ck_tenant_status CHECK (status IN ('ACTIVE', 'SUSPENDED'));
ALTER TABLE app_user ADD CONSTRAINT ck_app_user_auth_provider CHECK (auth_provider IN ('LOCAL', 'SAML', 'OIDC'));
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_source_type CHECK (source_type IN ('BI', 'EXTRACTION', 'UPLOAD', 'SEGMENT'));
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_list_environment CHECK (list_environment IN ('TEST', 'PRODUCTION'));
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_status CHECK (status IN ('ACTIVE', 'ARCHIVED'));
ALTER TABLE template_master ADD CONSTRAINT ck_template_master_channel CHECK (channel IN ('EMAIL', 'E_RECEIPT', 'SMS', 'MMS'));
ALTER TABLE template_master ADD CONSTRAINT ck_template_master_status CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));
ALTER TABLE personalization_tag ADD CONSTRAINT ck_personalization_tag_data_type CHECK (data_type IN ('STRING', 'NUMBER', 'DATE', 'BOOLEAN'));
ALTER TABLE receipt_presentation_model ADD CONSTRAINT ck_receipt_presentation_model_layout_type CHECK (layout_type IN ('POS', 'ENHANCED_RETAIL', 'ECOMMERCE', 'HYBRID'));
ALTER TABLE receipt_field_configuration ADD CONSTRAINT ck_receipt_field_configuration_section CHECK (section IN ('HEADER', 'ITEM_LINE', 'DISCOUNT', 'TAX', 'TOTALS', 'TENDER'));
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_campaign_type CHECK (campaign_type IN ('REGULAR_MARKETING', 'E_RECEIPT', 'DRIP', 'JOURNEY', 'OTHER'));
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS', 'MULTI'));
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_status CHECK (status IN ('DRAFT', 'TEST_PUBLISHED', 'PRODUCTION_PUBLISHED', 'ACTIVE', 'COMPLETED', 'CANCELLED'));
ALTER TABLE campaign_run ADD CONSTRAINT ck_campaign_run_run_type CHECK (run_type IN ('ONE_TIME', 'RECURRING_INSTANCE', 'DRIP_INSTANCE', 'JOURNEY_INSTANCE', 'ERECEIPT_INSTANCE'));
ALTER TABLE campaign_run ADD CONSTRAINT ck_campaign_run_status CHECK (status IN ('SCHEDULED', 'PREPARING', 'SENDING', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE campaign_run_variant ADD CONSTRAINT ck_campaign_run_variant_winner_metric CHECK (winner_metric IN ('OPEN_RATE', 'CLICK_RATE', 'CONVERSION_RATE'));
ALTER TABLE campaign_list ADD CONSTRAINT ck_campaign_list_status CHECK (status IN ('BUILDING', 'FROZEN', 'FAILED'));
ALTER TABLE campaign_list_member ADD CONSTRAINT ck_campaign_list_member_status CHECK (status IN ('ELIGIBLE', 'SUPPRESSED', 'SENT'));
ALTER TABLE journey ADD CONSTRAINT ck_journey_status CHECK (status IN ('DRAFT', 'TEST', 'APPROVED', 'ACTIVE', 'PAUSED', 'ARCHIVED'));
ALTER TABLE journey ADD CONSTRAINT ck_journey_population_mode CHECK (population_mode IN ('FIXED', 'CONTINUOUSLY_QUALIFYING', 'EVENT_TRIGGERED'));
ALTER TABLE journey ADD CONSTRAINT ck_journey_reentry_policy CHECK (reentry_policy IN ('NEVER', 'AFTER_X_DAYS', 'EVERY_QUALIFYING_EVENT'));
ALTER TABLE journey_version ADD CONSTRAINT ck_journey_version_status CHECK (status IN ('DRAFT', 'TEST_PUBLISHED', 'ACTIVE', 'RETIRED'));
ALTER TABLE journey_entry_rule ADD CONSTRAINT ck_journey_entry_rule_entry_type CHECK (entry_type IN ('CUSTOMER_LIST', 'EVENT', 'DATE_TIME', 'SEGMENT_CHANGE'));
ALTER TABLE journey_node ADD CONSTRAINT ck_journey_node_node_family CHECK (node_family IN ('ENTRY', 'LOGIC', 'COMMUNICATION', 'ACTION', 'CONTROL'));
ALTER TABLE journey_enrollment ADD CONSTRAINT ck_journey_enrollment_status CHECK (status IN ('ACTIVE', 'EXITED', 'COMPLETED'));
ALTER TABLE journey_node_execution ADD CONSTRAINT ck_journey_node_execution_execution_status CHECK (execution_status IN ('SUCCESS', 'FAILED', 'SKIPPED'));
ALTER TABLE communication_governance_policy ADD CONSTRAINT ck_communication_governance_policy_scope CHECK (scope IN ('GLOBAL', 'CHANNEL', 'CAMPAIGN_TYPE'));
ALTER TABLE communication_governance_policy ADD CONSTRAINT ck_communication_governance_policy_applies_to CHECK (applies_to IN ('MARKETING', 'ALL'));
ALTER TABLE governance_exemption ADD CONSTRAINT ck_governance_exemption_exemption_type CHECK (exemption_type IN ('TRANSACTIONAL', 'E_RECEIPT', 'VIP', 'MANUAL_OVERRIDE'));
ALTER TABLE consent_suppression ADD CONSTRAINT ck_consent_suppression_consent_status CHECK (consent_status IN ('OPTED_IN', 'OPTED_OUT', 'UNKNOWN'));
ALTER TABLE consent_suppression ADD CONSTRAINT ck_consent_suppression_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS'));
ALTER TABLE governance_evaluation_log ADD CONSTRAINT ck_governance_evaluation_log_decision CHECK (decision IN ('ALLOW', 'SUPPRESS'));
ALTER TABLE mailer_execution ADD CONSTRAINT ck_mailer_execution_status CHECK (status IN ('QUEUED', 'SUBMITTED', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED'));
ALTER TABLE sms_execution ADD CONSTRAINT ck_sms_execution_message_type CHECK (message_type IN ('SMS', 'MMS'));
ALTER TABLE sms_execution ADD CONSTRAINT ck_sms_execution_status CHECK (status IN ('QUEUED', 'SUBMITTED', 'DELIVERED', 'RESPONDED', 'FAILED', 'OPTED_OUT'));
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_provider CHECK (provider IN ('POSTAL', 'DIGIVIZE'));
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_execution_type CHECK (execution_type IN ('MAILER', 'SMS'));
ALTER TABLE delivery_webhook_event ADD CONSTRAINT ck_delivery_webhook_event_processing_status CHECK (processing_status IN ('PENDING', 'PROCESSED', 'FAILED'));
ALTER TABLE mailer_execution ADD CONSTRAINT ck_mailer_execution_bounce_type CHECK (bounce_type IN ('HARD', 'SOFT'));
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_list_kind CHECK (list_kind IN ('STATIC', 'DYNAMIC', 'SEGMENT', 'DERIVED'));
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_refresh_mode CHECK (refresh_mode IN ('MANUAL', 'SCHEDULED', 'ON_CAMPAIGN_BUILD'));
ALTER TABLE contact_list_member ADD CONSTRAINT ck_contact_list_member_membership_source CHECK (membership_source IN ('UPLOAD', 'RULE', 'SEGMENT', 'MANUAL'));
ALTER TABLE contact_list_member ADD CONSTRAINT ck_contact_list_member_matched_by CHECK (matched_by IN ('LOYALTY_ID', 'EMAIL', 'PHONE', 'PARTY_ID'));
ALTER TABLE contact_list_import ADD CONSTRAINT ck_contact_list_import_status CHECK (status IN ('UPLOADED', 'MATCHING', 'REVIEW', 'APPLIED', 'FAILED'));
ALTER TABLE contact_list_import_row ADD CONSTRAINT ck_contact_list_import_row_match_status CHECK (match_status IN ('PENDING', 'MATCHED', 'UNMATCHED', 'DUPLICATE', 'REJECTED'));
ALTER TABLE contact_list_import_row ADD CONSTRAINT ck_contact_list_import_row_match_method CHECK (match_method IN ('LOYALTY_ID', 'EMAIL', 'PHONE', 'PARTY_ID'));
ALTER TABLE personalization_tag ADD CONSTRAINT ck_personalization_tag_tag_kind CHECK (tag_kind IN ('STANDARD', 'CUSTOM', 'INNER_TEMPLATE', 'SEGMENT', 'SYSTEM'));
ALTER TABLE personalization_tag ADD CONSTRAINT ck_personalization_tag_resolution_source CHECK (resolution_source IN ('CUSTOMER_MASTER', 'CAMPAIGN_LIST_MEMBER', 'CAMPAIGN', 'CAMPAIGN_RUN', 'STORE', 'SYSTEM', 'STATIC', 'INNER_TEMPLATE', 'RECEIPT'));
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_solicitation_type CHECK (solicitation_type IN ('MARKETING', 'TRANSACTIONAL', 'SERVICE', 'LEGAL'));
ALTER TABLE consent_suppression ADD CONSTRAINT ck_consent_suppression_opt_out_method CHECK (opt_out_method IN ('UNSUBSCRIBE_LINK', 'SMS_STOP', 'PREFERENCE_CENTER', 'CSR', 'IMPORT', 'COMPLAINT'));
ALTER TABLE consent_suppression ADD CONSTRAINT ck_consent_suppression_marketable_reason CHECK (marketable_reason IN ('NO_CONSENT', 'UNSUBSCRIBED', 'SMS_STOP', 'HARD_BOUNCE', 'SOFT_BOUNCE_THRESHOLD', 'COMPLAINT', 'DND_REGISTRY', 'MANUAL_BLOCK', 'INVALID_ADDRESS', 'GLOBAL_SUPPRESSION_LIST'));
ALTER TABLE consent_record ADD CONSTRAINT ck_consent_record_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS'));
ALTER TABLE consent_record ADD CONSTRAINT ck_consent_record_action CHECK (action IN ('OPT_IN', 'DOUBLE_OPT_IN_CONFIRMED', 'OPT_OUT', 'RESUBSCRIBE'));
ALTER TABLE consent_record ADD CONSTRAINT ck_consent_record_source CHECK (source IN ('WEB_FORM', 'POS', 'IMPORT', 'UNSUBSCRIBE_LINK', 'SMS_STOP', 'PREFERENCE_CENTER', 'CSR', 'C360_SYNC', 'COMPLAINT', 'LEGAL'));
ALTER TABLE contact_point_status ADD CONSTRAINT ck_contact_point_status_contact_point_type CHECK (contact_point_type IN ('EMAIL', 'PHONE'));
ALTER TABLE contact_point_status ADD CONSTRAINT ck_contact_point_status_block_reason CHECK (block_reason IN ('HARD_BOUNCE', 'SOFT_BOUNCE_THRESHOLD', 'COMPLAINT', 'MANUAL', 'DND_REGISTRY', 'INVALID', 'GLOBAL_SUPPRESSION_LIST'));
ALTER TABLE delivery_provider ADD CONSTRAINT ck_delivery_provider_provider_type CHECK (provider_type IN ('POSTAL', 'DIGIVIZE', 'OTHER_ESP', 'OTHER_SMS'));
ALTER TABLE delivery_provider ADD CONSTRAINT ck_delivery_provider_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS'));
ALTER TABLE sender_profile ADD CONSTRAINT ck_sender_profile_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS'));
ALTER TABLE sender_profile ADD CONSTRAINT ck_sender_profile_verification_status CHECK (verification_status IN ('PENDING', 'VERIFIED', 'FAILED'));
ALTER TABLE dead_letter_message ADD CONSTRAINT ck_dead_letter_message_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS'));
ALTER TABLE dead_letter_message ADD CONSTRAINT ck_dead_letter_message_status CHECK (status IN ('OPEN', 'RETRIED', 'DISCARDED'));
ALTER TABLE definition_audit_log ADD CONSTRAINT ck_definition_audit_log_action CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'));

ALTER TABLE campaign_run_variant ADD CONSTRAINT ck_campaign_run_variant_allocation CHECK (allocation_pct >= 0 AND allocation_pct <= 100);
ALTER TABLE journey ADD CONSTRAINT ck_journey_reentry_days CHECK (reentry_policy <> 'AFTER_X_DAYS' OR reentry_after_days > 0);
ALTER TABLE communication_governance_policy ADD CONSTRAINT ck_governance_policy_limits CHECK (max_messages > 0 AND period_days > 0);
ALTER TABLE journey_generated_campaign_run ADD CONSTRAINT ck_journey_window_order CHECK (execution_window_end > execution_window_start);
ALTER TABLE campaign_run ADD CONSTRAINT ck_campaign_run_timeline CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at);
ALTER TABLE sms_execution ADD CONSTRAINT ck_sms_media_only_mms CHECK (message_type = 'MMS' OR media_url IS NULL);
ALTER TABLE media_asset ADD CONSTRAINT ck_media_asset_size CHECK (byte_size >= 0);
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_derived_parent CHECK (list_kind <> 'DERIVED' OR parent_contact_list_id IS NOT NULL);
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_rule_criteria CHECK (list_kind NOT IN ('DYNAMIC', 'DERIVED') OR criteria IS NOT NULL);
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_no_self_parent CHECK (parent_contact_list_id IS NULL OR parent_contact_list_id <> id);
ALTER TABLE personalization_tag ADD CONSTRAINT ck_tag_inner_template CHECK (tag_kind <> 'INNER_TEMPLATE' OR inner_template_id IS NOT NULL);
ALTER TABLE personalization_tag ADD CONSTRAINT ck_tag_static_value CHECK (resolution_source <> 'STATIC' OR static_value IS NOT NULL);
ALTER TABLE contact_point_status ADD CONSTRAINT ck_contact_point_block CHECK (NOT blocked OR block_reason IS NOT NULL);
ALTER TABLE contact_point_status ADD CONSTRAINT ck_contact_point_counts CHECK (hard_bounce_count >= 0 AND soft_bounce_count >= 0 AND complaint_count >= 0);
ALTER TABLE consent_suppression ADD CONSTRAINT ck_consent_marketable CHECK (NOT marketable OR consent_status = 'OPTED_IN');
ALTER TABLE communication_governance_policy ADD CONSTRAINT ck_governance_soft_bounce CHECK (soft_bounce_threshold IS NULL OR (soft_bounce_threshold > 0 AND soft_bounce_window_days > 0));
ALTER TABLE journey_node ADD CONSTRAINT ck_journey_node_config_object CHECK (jsonb_typeof(config) = 'object');
ALTER TABLE journey_entry_rule ADD CONSTRAINT ck_journey_entry_rule_object CHECK (jsonb_typeof(rule_definition) = 'object');
ALTER TABLE contact_list ADD CONSTRAINT ck_contact_list_criteria_object CHECK (criteria IS NULL OR jsonb_typeof(criteria) = 'object');
ALTER TABLE contact_list_member ADD CONSTRAINT ck_contact_list_member_attrs_object CHECK (jsonb_typeof(custom_attributes) = 'object');
ALTER TABLE campaign_list_member ADD CONSTRAINT ck_campaign_list_member_pairs_object CHECK (jsonb_typeof(custom_value_pairs) = 'object');
ALTER TABLE customer_master ADD CONSTRAINT ck_customer_master_contacts_arrays CHECK (jsonb_typeof(emails) = 'array' AND jsonb_typeof(phones) = 'array');
ALTER TABLE template_design_state ADD CONSTRAINT ck_template_design_state_object CHECK (jsonb_typeof(editor_state) = 'object');
ALTER TABLE consent_record ADD CONSTRAINT ck_consent_record_evidence_object CHECK (jsonb_typeof(evidence) = 'object');
ALTER TABLE personalization_tag ADD CONSTRAINT ck_tag_channels_known CHECK (applies_to_channels <@ ARRAY['EMAIL', 'E_RECEIPT', 'SMS', 'MMS']::text[]);
ALTER TABLE contact_point_status ADD CONSTRAINT ck_contact_point_phone_e164 CHECK (contact_point_type <> 'PHONE' OR contact_value ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE sms_execution ADD CONSTRAINT ck_sms_phone_e164 CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE campaign ADD CONSTRAINT ck_campaign_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$');
ALTER TABLE journey ADD CONSTRAINT ck_journey_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$');

-- =====================================================================================
-- 4. ROW-LEVEL SECURITY — tenant isolation enforced by PostgreSQL.
--    cep_app (the application role) sees only rows whose tenant_id matches app.current_tenant.
--    cep_admin (migrations, ETL, support) bypasses RLS. Policies on a partitioned parent apply
--    to queries through the parent; direct partition access is reserved for cep_admin.
-- =====================================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_app')   THEN CREATE ROLE cep_app   NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cep_admin') THEN CREATE ROLE cep_admin NOLOGIN BYPASSRLS; END IF;
END $$;

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_app_user_tenant ON app_user
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_role_tenant ON role
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE customer_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_master FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_customer_master_tenant ON customer_master
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_segment_tenant ON segment
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE customer_segment_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_segment_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_customer_segment_membership_tenant ON customer_segment_membership
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_list_tenant ON contact_list
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_list_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_member FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_list_member_tenant ON contact_list_member
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_list_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_import FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_list_import_tenant ON contact_list_import
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_list_import_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_import_row FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_list_import_row_tenant ON contact_list_import_row
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE template_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_master FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_template_master_tenant ON template_master
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE personalization_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE personalization_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_personalization_tag_tenant ON personalization_tag
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE template_tag ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_tag FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_template_tag_tenant ON template_tag
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE receipt_presentation_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_presentation_model FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_receipt_presentation_model_tenant ON receipt_presentation_model
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_tenant ON campaign
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_run FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_run_tenant ON campaign_run
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_list_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_list_campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_list_campaign_tenant ON contact_list_campaign
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_list FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_list_tenant ON campaign_list
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_list_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_list_member FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_list_member_tenant ON campaign_list_member
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_target ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_target FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_target_tenant ON campaign_target
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_actual ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_actual FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_actual_tenant ON campaign_actual
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_tenant ON journey
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_enrollment ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_enrollment FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_enrollment_tenant ON journey_enrollment
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_node_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_node_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_node_execution_tenant ON journey_node_execution
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_event FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_event_tenant ON journey_event
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_generated_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_generated_campaign FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_generated_campaign_tenant ON journey_generated_campaign
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_generated_campaign_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_generated_campaign_run FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_generated_campaign_run_tenant ON journey_generated_campaign_run
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE communication_governance_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_governance_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_communication_governance_policy_tenant ON communication_governance_policy
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE contact_point_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_point_status FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_contact_point_status_tenant ON contact_point_status
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE consent_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_suppression FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_consent_suppression_tenant ON consent_suppression
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_record FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_consent_record_tenant ON consent_record
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE governance_evaluation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_evaluation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_governance_evaluation_log_tenant ON governance_evaluation_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE mailer_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailer_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_mailer_execution_tenant ON mailer_execution
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE sms_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_sms_execution_tenant ON sms_execution
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE delivery_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_webhook_event FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_delivery_webhook_event_tenant ON delivery_webhook_event
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE campaign_master_analytical ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_master_analytical FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_campaign_master_analytical_tenant ON campaign_master_analytical
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_master_analytical ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_master_analytical FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_master_analytical_tenant ON journey_master_analytical
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE journey_execution_master_analytical ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_execution_master_analytical FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_journey_execution_master_analytical_tenant ON journey_execution_master_analytical
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE delivery_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_provider FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_delivery_provider_tenant ON delivery_provider
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE sender_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sender_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_sender_profile_tenant ON sender_profile
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE media_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_media_asset_tenant ON media_asset
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE template_media_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_media_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_template_media_asset_tenant ON template_media_asset
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE dead_letter_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_message FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_dead_letter_message_tenant ON dead_letter_message
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE definition_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE definition_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_definition_audit_log_tenant ON definition_audit_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cep_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cep_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO cep_admin;

-- =====================================================================================
-- 8. PII CLASSIFICATION — machine-readable tags for masking, DSAR export and data-retention tooling
-- =====================================================================================

COMMENT ON COLUMN customer_master.first_name IS 'PII: personal name';
COMMENT ON COLUMN customer_master.last_name IS 'PII: personal name';
COMMENT ON COLUMN customer_master.emails IS 'PII: email addresses — encrypt at rest, mask in non-production';
COMMENT ON COLUMN customer_master.phones IS 'PII: phone numbers — encrypt at rest, mask in non-production';
COMMENT ON COLUMN customer_master.primary_address IS 'PII: postal address';
COMMENT ON COLUMN customer_master.custom_attributes IS 'PII-possible: loyalty/RFM attributes synced from C360; review keys before exposing';
COMMENT ON COLUMN app_user.email IS 'PII: staff email (login identity)';
COMMENT ON COLUMN app_user.display_name IS 'PII: staff name';
COMMENT ON COLUMN contact_list_member.custom_attributes IS 'PII-possible: uploaded list attributes may carry personal data';
COMMENT ON COLUMN campaign_list_member.custom_value_pairs IS 'PII-possible: campaign-time attributes may carry personal data';
COMMENT ON COLUMN mailer_execution.email_address IS 'PII: recipient email — mask in non-production';
COMMENT ON COLUMN mailer_execution.ip_address IS 'PII: engagement IP address (GDPR personal data)';
COMMENT ON COLUMN mailer_execution.user_agent IS 'PII-possible: device fingerprint';
COMMENT ON COLUMN sms_execution.phone_number IS 'PII: recipient phone — mask in non-production';
COMMENT ON COLUMN contact_point_status.contact_value IS 'PII: email address or phone number — mask in non-production';
COMMENT ON COLUMN contact_list_import_row.raw IS 'PII: uploaded row exactly as received — purge per retention policy';
COMMENT ON COLUMN consent_record.evidence IS 'PII-possible: IP address / user agent captured as consent evidence';
COMMENT ON COLUMN definition_audit_log.old_row IS 'PII-possible: full copy of audited row (e.g. app_user)';
COMMENT ON COLUMN definition_audit_log.new_row IS 'PII-possible: full copy of audited row (e.g. app_user)';

-- =====================================================================================
-- 9. DESIGN-STANDARD PASS
-- =====================================================================================

-- 9a. Every table documented in the catalog (purpose text is the same as the Tables sheet of the workbook).
COMMENT ON TABLE tenant IS 'Workspace/organization root for multi-tenancy';
COMMENT ON TABLE app_user IS 'Platform user login/identity';
COMMENT ON TABLE role IS 'Named permission bundle';
COMMENT ON TABLE permission IS 'Individual grantable permission';
COMMENT ON TABLE role_permission IS 'Role-to-permission assignment';
COMMENT ON TABLE user_role IS 'User-to-role assignment';
COMMENT ON TABLE customer_master IS 'Non-authoritative synced copy of C360''s denormalized Customer Master (BRD TD-02)';
COMMENT ON TABLE segment IS 'Cached reference to a C360/BI segment definition';
COMMENT ON TABLE customer_segment_membership IS 'Party membership in a synced segment';
COMMENT ON TABLE contact_list IS 'Reusable customer population from BI / extraction / upload';
COMMENT ON TABLE contact_list_member IS 'Party membership in a Contact List — party_id references only, never customer attributes (hash-partitioned)';
COMMENT ON TABLE contact_list_import IS 'An upload job: file, identity-resolution rules, match / unmatched / duplicate counts';
COMMENT ON TABLE contact_list_import_row IS 'Staging row matched to a party_id before it can become a membership (tenant + monthly partitioned)';
COMMENT ON TABLE template_master IS 'Channel-aware template identity (Email / E-Receipt / SMS / MMS)';
COMMENT ON TABLE template_design_state IS 'Versioned GrapesJS/MJML editable design state';
COMMENT ON TABLE rendered_template_content IS 'Send-ready rendered HTML/text/SMS content';
COMMENT ON TABLE personalization_tag IS 'Tag catalogue: STANDARD / CUSTOM / INNER_TEMPLATE / SEGMENT / SYSTEM with resolution source, default and format';
COMMENT ON TABLE template_tag IS 'Which tags a template uses, with mandatory flag — validated against the campaign list at publish';
COMMENT ON TABLE receipt_presentation_model IS 'Out-of-the-box POS/eCommerce receipt layout model';
COMMENT ON TABLE receipt_field_configuration IS 'Client field show/hide/label/order rules for a receipt template';
COMMENT ON TABLE campaign IS 'Universal outbound communication execution container';
COMMENT ON TABLE campaign_run IS 'Discrete execution/batch beneath a Campaign';
COMMENT ON TABLE campaign_run_variant IS 'Phase II subject-line/content variant — unused by MVP send logic';
COMMENT ON TABLE contact_list_campaign IS 'Attaches one or more Contact Lists to a Campaign';
COMMENT ON TABLE campaign_list IS 'Denormalized campaign-specific population, merged/de-duplicated';
COMMENT ON TABLE campaign_list_member IS 'Party-level campaign execution population record (range-partitioned)';
COMMENT ON TABLE campaign_target IS 'Planned revenue / engagement / cost targets for a Campaign';
COMMENT ON TABLE campaign_actual IS 'Actual cost, attributed revenue, ROI/contribution for a Campaign';
COMMENT ON TABLE journey IS 'Independent orchestration definition — not a child of Campaign';
COMMENT ON TABLE journey_version IS 'Versioned Journey configuration snapshot';
COMMENT ON TABLE journey_entry_rule IS 'Entry/population criteria for a Journey version';
COMMENT ON TABLE journey_node IS 'Entry / logic / communication / action / control node in a Journey graph';
COMMENT ON TABLE journey_connection IS 'Path/edge between two Journey nodes';
COMMENT ON TABLE journey_enrollment IS 'Party participation instance in a Journey';
COMMENT ON TABLE journey_customer_state IS 'Current node/status for an active enrollment';
COMMENT ON TABLE journey_node_execution IS 'Execution result/history per node per party (range-partitioned)';
COMMENT ON TABLE journey_event IS 'Inbound trigger event feed: purchase, cart abandon, engagement, etc. (range-partitioned)';
COMMENT ON TABLE journey_generated_campaign IS 'Links a Journey node''s execution window to a generated Campaign';
COMMENT ON TABLE journey_generated_campaign_run IS 'Links a generated Campaign to its Campaign Run and execution window';
COMMENT ON TABLE communication_governance_policy IS 'Cross-campaign / cross-journey frequency-cap rule';
COMMENT ON TABLE governance_exemption IS 'Exemption (transactional/e-receipt/VIP/override) from a governance policy';
COMMENT ON TABLE contact_point_status IS 'Health of one email address / phone number: bounces, complaints, block reason — shared by every campaign';
COMMENT ON TABLE consent_suppression IS 'Current consent per party per channel with stored MARKETABLE flag and reason';
COMMENT ON TABLE consent_record IS 'Append-only opt-in / opt-out proof with source and evidence (tenant + monthly partitioned, kept indefinitely)';
COMMENT ON TABLE governance_evaluation_log IS 'Audit log of every governance allow/suppress decision (range-partitioned)';
COMMENT ON TABLE mailer_execution IS 'Email send/outcome record per recipient per run, idempotency-keyed (range-partitioned)';
COMMENT ON TABLE sms_execution IS 'SMS/MMS send/outcome record per recipient per run, idempotency-keyed (range-partitioned)';
COMMENT ON TABLE delivery_webhook_event IS 'Raw inbound Postal/Digivize webhook log ahead of processing (range-partitioned)';
COMMENT ON TABLE campaign_master_analytical IS 'Denormalized per-campaign reporting rollup';
COMMENT ON TABLE journey_master_analytical IS 'Denormalized per-journey reporting rollup';
COMMENT ON TABLE journey_execution_master_analytical IS 'Flattened Party/Journey/node/event/campaign/outcome fact table (range-partitioned)';
COMMENT ON TABLE delivery_provider IS 'Postal / Digivize / future ESP configuration; secrets held by reference only';
COMMENT ON TABLE sender_profile IS 'Verified from-name / from-address / SMS sender id per channel and provider';
COMMENT ON TABLE media_asset IS 'Images and MMS media in object storage, checksum de-duplicated';
COMMENT ON TABLE template_media_asset IS 'Which templates use which media asset (blocks deleting in-use media)';
COMMENT ON TABLE dead_letter_message IS 'Permanently failed sends persisted for operator review and replay (range-partitioned)';
COMMENT ON TABLE definition_audit_log IS 'Before/after change history of every campaign, journey, template and policy definition (tenant + monthly partitioned)';

-- 9b. reference_code: the labelled catalogue behind every CHECK constraint (code_set = '<table>.<column>').
--     CHECK constraints enforce membership; this table supplies labels, ordering and activation for UI / i18n / reporting
--     (the pattern iCRM's status_item / enumeration got right, with enforcement added).
CREATE TABLE reference_code (
    code_set            VARCHAR(80) NOT NULL,            -- '<table>.<column>'
    code                VARCHAR(40) NOT NULL,
    label               VARCHAR(120) NOT NULL,
    description         TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (code_set, code)
);
COMMENT ON TABLE reference_code IS 'Labelled catalogue of every closed value set; code_set = table.column. CHECK constraints enforce, this table describes.';
INSERT INTO reference_code (code_set, code, label, sort_order) VALUES
    ('tenant.status', 'ACTIVE', 'Active', 1),
    ('tenant.status', 'SUSPENDED', 'Suspended', 2),
    ('app_user.auth_provider', 'LOCAL', 'Local', 1),
    ('app_user.auth_provider', 'SAML', 'SAML', 2),
    ('app_user.auth_provider', 'OIDC', 'OIDC', 3),
    ('contact_list.source_type', 'BI', 'Bi', 1),
    ('contact_list.source_type', 'EXTRACTION', 'Extraction', 2),
    ('contact_list.source_type', 'UPLOAD', 'Upload', 3),
    ('contact_list.source_type', 'SEGMENT', 'Segment', 4),
    ('contact_list.list_environment', 'TEST', 'Test', 1),
    ('contact_list.list_environment', 'PRODUCTION', 'Production', 2),
    ('contact_list.status', 'ACTIVE', 'Active', 1),
    ('contact_list.status', 'ARCHIVED', 'Archived', 2),
    ('template_master.channel', 'EMAIL', 'Email', 1),
    ('template_master.channel', 'E_RECEIPT', 'E Receipt', 2),
    ('template_master.channel', 'SMS', 'SMS', 3),
    ('template_master.channel', 'MMS', 'MMS', 4),
    ('template_master.status', 'DRAFT', 'Draft', 1),
    ('template_master.status', 'ACTIVE', 'Active', 2),
    ('template_master.status', 'ARCHIVED', 'Archived', 3),
    ('personalization_tag.data_type', 'STRING', 'String', 1),
    ('personalization_tag.data_type', 'NUMBER', 'Number', 2),
    ('personalization_tag.data_type', 'DATE', 'Date', 3),
    ('personalization_tag.data_type', 'BOOLEAN', 'Boolean', 4),
    ('receipt_presentation_model.layout_type', 'POS', 'POS', 1),
    ('receipt_presentation_model.layout_type', 'ENHANCED_RETAIL', 'Enhanced Retail', 2),
    ('receipt_presentation_model.layout_type', 'ECOMMERCE', 'Ecommerce', 3),
    ('receipt_presentation_model.layout_type', 'HYBRID', 'Hybrid', 4),
    ('receipt_field_configuration.section', 'HEADER', 'Header', 1),
    ('receipt_field_configuration.section', 'ITEM_LINE', 'Item Line', 2),
    ('receipt_field_configuration.section', 'DISCOUNT', 'Discount', 3),
    ('receipt_field_configuration.section', 'TAX', 'Tax', 4),
    ('receipt_field_configuration.section', 'TOTALS', 'Totals', 5),
    ('receipt_field_configuration.section', 'TENDER', 'Tender', 6),
    ('campaign.campaign_type', 'REGULAR_MARKETING', 'Regular Marketing', 1),
    ('campaign.campaign_type', 'E_RECEIPT', 'E Receipt', 2),
    ('campaign.campaign_type', 'DRIP', 'Drip', 3),
    ('campaign.campaign_type', 'JOURNEY', 'Journey', 4),
    ('campaign.campaign_type', 'OTHER', 'Other', 5),
    ('campaign.channel', 'EMAIL', 'Email', 1),
    ('campaign.channel', 'SMS', 'SMS', 2),
    ('campaign.channel', 'MMS', 'MMS', 3),
    ('campaign.channel', 'MULTI', 'Multi', 4),
    ('campaign.status', 'DRAFT', 'Draft', 1),
    ('campaign.status', 'TEST_PUBLISHED', 'Test Published', 2),
    ('campaign.status', 'PRODUCTION_PUBLISHED', 'Production Published', 3),
    ('campaign.status', 'ACTIVE', 'Active', 4),
    ('campaign.status', 'COMPLETED', 'Completed', 5),
    ('campaign.status', 'CANCELLED', 'Cancelled', 6),
    ('campaign_run.run_type', 'ONE_TIME', 'One Time', 1),
    ('campaign_run.run_type', 'RECURRING_INSTANCE', 'Recurring Instance', 2),
    ('campaign_run.run_type', 'DRIP_INSTANCE', 'Drip Instance', 3),
    ('campaign_run.run_type', 'JOURNEY_INSTANCE', 'Journey Instance', 4),
    ('campaign_run.run_type', 'ERECEIPT_INSTANCE', 'Ereceipt Instance', 5),
    ('campaign_run.status', 'SCHEDULED', 'Scheduled', 1),
    ('campaign_run.status', 'PREPARING', 'Preparing', 2),
    ('campaign_run.status', 'SENDING', 'Sending', 3),
    ('campaign_run.status', 'COMPLETED', 'Completed', 4),
    ('campaign_run.status', 'FAILED', 'Failed', 5),
    ('campaign_run.status', 'CANCELLED', 'Cancelled', 6),
    ('campaign_run_variant.winner_metric', 'OPEN_RATE', 'Open Rate', 1),
    ('campaign_run_variant.winner_metric', 'CLICK_RATE', 'Click Rate', 2),
    ('campaign_run_variant.winner_metric', 'CONVERSION_RATE', 'Conversion Rate', 3),
    ('campaign_list.status', 'BUILDING', 'Building', 1),
    ('campaign_list.status', 'FROZEN', 'Frozen', 2),
    ('campaign_list.status', 'FAILED', 'Failed', 3),
    ('campaign_list_member.status', 'ELIGIBLE', 'Eligible', 1),
    ('campaign_list_member.status', 'SUPPRESSED', 'Suppressed', 2),
    ('campaign_list_member.status', 'SENT', 'Sent', 3),
    ('journey.status', 'DRAFT', 'Draft', 1),
    ('journey.status', 'TEST', 'Test', 2),
    ('journey.status', 'ACTIVE', 'Active', 3),
    ('journey.status', 'PAUSED', 'Paused', 4),
    ('journey.status', 'ARCHIVED', 'Archived', 5),
    ('journey.population_mode', 'FIXED', 'Fixed', 1),
    ('journey.population_mode', 'CONTINUOUSLY_QUALIFYING', 'Continuously Qualifying', 2),
    ('journey.population_mode', 'EVENT_TRIGGERED', 'Event Triggered', 3),
    ('journey.reentry_policy', 'NEVER', 'Never', 1),
    ('journey.reentry_policy', 'AFTER_X_DAYS', 'After X Days', 2),
    ('journey.reentry_policy', 'EVERY_QUALIFYING_EVENT', 'Every Qualifying Event', 3),
    ('journey_version.status', 'DRAFT', 'Draft', 1),
    ('journey_version.status', 'TEST_PUBLISHED', 'Test Published', 2),
    ('journey_version.status', 'ACTIVE', 'Active', 3),
    ('journey_version.status', 'RETIRED', 'Retired', 4),
    ('journey_entry_rule.entry_type', 'CUSTOMER_LIST', 'Customer List', 1),
    ('journey_entry_rule.entry_type', 'EVENT', 'Event', 2),
    ('journey_entry_rule.entry_type', 'DATE_TIME', 'Date Time', 3),
    ('journey_entry_rule.entry_type', 'SEGMENT_CHANGE', 'Segment Change', 4),
    ('journey_node.node_family', 'ENTRY', 'Entry', 1),
    ('journey_node.node_family', 'LOGIC', 'Logic', 2),
    ('journey_node.node_family', 'COMMUNICATION', 'Communication', 3),
    ('journey_node.node_family', 'ACTION', 'Action', 4),
    ('journey_node.node_family', 'CONTROL', 'Control', 5),
    ('journey_enrollment.status', 'ACTIVE', 'Active', 1),
    ('journey_enrollment.status', 'EXITED', 'Exited', 2),
    ('journey_enrollment.status', 'COMPLETED', 'Completed', 3),
    ('journey_node_execution.execution_status', 'SUCCESS', 'Success', 1),
    ('journey_node_execution.execution_status', 'FAILED', 'Failed', 2),
    ('journey_node_execution.execution_status', 'SKIPPED', 'Skipped', 3),
    ('communication_governance_policy.scope', 'GLOBAL', 'Global', 1),
    ('communication_governance_policy.scope', 'CHANNEL', 'Channel', 2),
    ('communication_governance_policy.scope', 'CAMPAIGN_TYPE', 'Campaign Type', 3),
    ('communication_governance_policy.applies_to', 'MARKETING', 'Marketing', 1),
    ('communication_governance_policy.applies_to', 'ALL', 'All', 2),
    ('governance_exemption.exemption_type', 'TRANSACTIONAL', 'Transactional', 1),
    ('governance_exemption.exemption_type', 'E_RECEIPT', 'E Receipt', 2),
    ('governance_exemption.exemption_type', 'VIP', 'Vip', 3),
    ('governance_exemption.exemption_type', 'MANUAL_OVERRIDE', 'Manual Override', 4),
    ('consent_suppression.consent_status', 'OPTED_IN', 'Opted In', 1),
    ('consent_suppression.consent_status', 'OPTED_OUT', 'Opted Out', 2),
    ('consent_suppression.consent_status', 'UNKNOWN', 'Unknown', 3),
    ('consent_suppression.channel', 'EMAIL', 'Email', 1),
    ('consent_suppression.channel', 'SMS', 'SMS', 2),
    ('consent_suppression.channel', 'MMS', 'MMS', 3),
    ('governance_evaluation_log.decision', 'ALLOW', 'Allow', 1),
    ('governance_evaluation_log.decision', 'SUPPRESS', 'Suppress', 2),
    ('mailer_execution.status', 'QUEUED', 'Queued', 1),
    ('mailer_execution.status', 'SUBMITTED', 'Submitted', 2),
    ('mailer_execution.status', 'DELIVERED', 'Delivered', 3),
    ('mailer_execution.status', 'OPENED', 'Opened', 4),
    ('mailer_execution.status', 'CLICKED', 'Clicked', 5),
    ('mailer_execution.status', 'BOUNCED', 'Bounced', 6),
    ('mailer_execution.status', 'COMPLAINED', 'Complained', 7),
    ('mailer_execution.status', 'FAILED', 'Failed', 8),
    ('sms_execution.message_type', 'SMS', 'SMS', 1),
    ('sms_execution.message_type', 'MMS', 'MMS', 2),
    ('sms_execution.status', 'QUEUED', 'Queued', 1),
    ('sms_execution.status', 'SUBMITTED', 'Submitted', 2),
    ('sms_execution.status', 'DELIVERED', 'Delivered', 3),
    ('sms_execution.status', 'RESPONDED', 'Responded', 4),
    ('sms_execution.status', 'FAILED', 'Failed', 5),
    ('sms_execution.status', 'OPTED_OUT', 'Opted Out', 6),
    ('delivery_webhook_event.provider', 'POSTAL', 'POStal', 1),
    ('delivery_webhook_event.provider', 'DIGIVIZE', 'Digivize', 2),
    ('delivery_webhook_event.execution_type', 'MAILER', 'Mailer', 1),
    ('delivery_webhook_event.execution_type', 'SMS', 'SMS', 2),
    ('delivery_webhook_event.processing_status', 'PENDING', 'Pending', 1),
    ('delivery_webhook_event.processing_status', 'PROCESSED', 'Processed', 2),
    ('delivery_webhook_event.processing_status', 'FAILED', 'Failed', 3),
    ('mailer_execution.bounce_type', 'HARD', 'Hard', 1),
    ('mailer_execution.bounce_type', 'SOFT', 'Soft', 2),
    ('contact_list.list_kind', 'STATIC', 'Static', 1),
    ('contact_list.list_kind', 'DYNAMIC', 'Dynamic', 2),
    ('contact_list.list_kind', 'SEGMENT', 'Segment', 3),
    ('contact_list.list_kind', 'DERIVED', 'Derived', 4),
    ('contact_list.refresh_mode', 'MANUAL', 'Manual', 1),
    ('contact_list.refresh_mode', 'SCHEDULED', 'Scheduled', 2),
    ('contact_list.refresh_mode', 'ON_CAMPAIGN_BUILD', 'On Campaign Build', 3),
    ('contact_list_member.membership_source', 'UPLOAD', 'Upload', 1),
    ('contact_list_member.membership_source', 'RULE', 'Rule', 2),
    ('contact_list_member.membership_source', 'SEGMENT', 'Segment', 3),
    ('contact_list_member.membership_source', 'MANUAL', 'Manual', 4),
    ('contact_list_member.matched_by', 'LOYALTY_ID', 'Loyalty ID', 1),
    ('contact_list_member.matched_by', 'EMAIL', 'Email', 2),
    ('contact_list_member.matched_by', 'PHONE', 'Phone', 3),
    ('contact_list_member.matched_by', 'PARTY_ID', 'Party ID', 4),
    ('contact_list_import.status', 'UPLOADED', 'Uploaded', 1),
    ('contact_list_import.status', 'MATCHING', 'Matching', 2),
    ('contact_list_import.status', 'REVIEW', 'Review', 3),
    ('contact_list_import.status', 'APPLIED', 'Applied', 4),
    ('contact_list_import.status', 'FAILED', 'Failed', 5),
    ('contact_list_import_row.match_status', 'PENDING', 'Pending', 1),
    ('contact_list_import_row.match_status', 'MATCHED', 'Matched', 2),
    ('contact_list_import_row.match_status', 'UNMATCHED', 'Unmatched', 3),
    ('contact_list_import_row.match_status', 'DUPLICATE', 'Duplicate', 4),
    ('contact_list_import_row.match_status', 'REJECTED', 'Rejected', 5),
    ('contact_list_import_row.match_method', 'LOYALTY_ID', 'Loyalty ID', 1),
    ('contact_list_import_row.match_method', 'EMAIL', 'Email', 2),
    ('contact_list_import_row.match_method', 'PHONE', 'Phone', 3),
    ('contact_list_import_row.match_method', 'PARTY_ID', 'Party ID', 4),
    ('personalization_tag.tag_kind', 'STANDARD', 'Standard', 1),
    ('personalization_tag.tag_kind', 'CUSTOM', 'Custom', 2),
    ('personalization_tag.tag_kind', 'INNER_TEMPLATE', 'Inner Template', 3),
    ('personalization_tag.tag_kind', 'SEGMENT', 'Segment', 4),
    ('personalization_tag.tag_kind', 'SYSTEM', 'System', 5),
    ('personalization_tag.resolution_source', 'CUSTOMER_MASTER', 'Customer Master', 1),
    ('personalization_tag.resolution_source', 'CAMPAIGN_LIST_MEMBER', 'Campaign List Member', 2),
    ('personalization_tag.resolution_source', 'CAMPAIGN', 'Campaign', 3),
    ('personalization_tag.resolution_source', 'CAMPAIGN_RUN', 'Campaign Run', 4),
    ('personalization_tag.resolution_source', 'STORE', 'Store', 5),
    ('personalization_tag.resolution_source', 'SYSTEM', 'System', 6),
    ('personalization_tag.resolution_source', 'STATIC', 'Static', 7),
    ('personalization_tag.resolution_source', 'INNER_TEMPLATE', 'Inner Template', 8),
    ('personalization_tag.resolution_source', 'RECEIPT', 'Receipt', 9),
    ('campaign.solicitation_type', 'MARKETING', 'Marketing', 1),
    ('campaign.solicitation_type', 'TRANSACTIONAL', 'Transactional', 2),
    ('campaign.solicitation_type', 'SERVICE', 'Service', 3),
    ('campaign.solicitation_type', 'LEGAL', 'Legal', 4),
    ('consent_suppression.opt_out_method', 'UNSUBSCRIBE_LINK', 'Unsubscribe Link', 1),
    ('consent_suppression.opt_out_method', 'SMS_STOP', 'SMS Stop', 2),
    ('consent_suppression.opt_out_method', 'PREFERENCE_CENTER', 'Preference Center', 3),
    ('consent_suppression.opt_out_method', 'CSR', 'CSR', 4),
    ('consent_suppression.opt_out_method', 'IMPORT', 'Import', 5),
    ('consent_suppression.opt_out_method', 'COMPLAINT', 'Complaint', 6),
    ('consent_suppression.marketable_reason', 'NO_CONSENT', 'No Consent', 1),
    ('consent_suppression.marketable_reason', 'UNSUBSCRIBED', 'Unsubscribed', 2),
    ('consent_suppression.marketable_reason', 'SMS_STOP', 'SMS Stop', 3),
    ('consent_suppression.marketable_reason', 'HARD_BOUNCE', 'Hard Bounce', 4),
    ('consent_suppression.marketable_reason', 'SOFT_BOUNCE_THRESHOLD', 'Soft Bounce Threshold', 5),
    ('consent_suppression.marketable_reason', 'COMPLAINT', 'Complaint', 6),
    ('consent_suppression.marketable_reason', 'DND_REGISTRY', 'DND Registry', 7),
    ('consent_suppression.marketable_reason', 'MANUAL_BLOCK', 'Manual Block', 8),
    ('consent_suppression.marketable_reason', 'INVALID_ADDRESS', 'Invalid Address', 9),
    ('consent_suppression.marketable_reason', 'GLOBAL_SUPPRESSION_LIST', 'Global Suppression List', 10),
    ('consent_record.channel', 'EMAIL', 'Email', 1),
    ('consent_record.channel', 'SMS', 'SMS', 2),
    ('consent_record.channel', 'MMS', 'MMS', 3),
    ('consent_record.action', 'OPT_IN', 'Opt In', 1),
    ('consent_record.action', 'DOUBLE_OPT_IN_CONFIRMED', 'Double Opt In Confirmed', 2),
    ('consent_record.action', 'OPT_OUT', 'Opt Out', 3),
    ('consent_record.action', 'RESUBSCRIBE', 'Resubscribe', 4),
    ('consent_record.source', 'WEB_FORM', 'Web Form', 1),
    ('consent_record.source', 'POS', 'POS', 2),
    ('consent_record.source', 'IMPORT', 'Import', 3),
    ('consent_record.source', 'UNSUBSCRIBE_LINK', 'Unsubscribe Link', 4),
    ('consent_record.source', 'SMS_STOP', 'SMS Stop', 5),
    ('consent_record.source', 'PREFERENCE_CENTER', 'Preference Center', 6),
    ('consent_record.source', 'CSR', 'CSR', 7),
    ('consent_record.source', 'C360_SYNC', 'C360 Sync', 8),
    ('consent_record.source', 'COMPLAINT', 'Complaint', 9),
    ('consent_record.source', 'LEGAL', 'Legal', 10),
    ('contact_point_status.contact_point_type', 'EMAIL', 'Email', 1),
    ('contact_point_status.contact_point_type', 'PHONE', 'Phone', 2),
    ('contact_point_status.block_reason', 'HARD_BOUNCE', 'Hard Bounce', 1),
    ('contact_point_status.block_reason', 'SOFT_BOUNCE_THRESHOLD', 'Soft Bounce Threshold', 2),
    ('contact_point_status.block_reason', 'COMPLAINT', 'Complaint', 3),
    ('contact_point_status.block_reason', 'MANUAL', 'Manual', 4),
    ('contact_point_status.block_reason', 'DND_REGISTRY', 'DND Registry', 5),
    ('contact_point_status.block_reason', 'INVALID', 'Invalid', 6),
    ('contact_point_status.block_reason', 'GLOBAL_SUPPRESSION_LIST', 'Global Suppression List', 7),
    ('delivery_provider.provider_type', 'POSTAL', 'POStal', 1),
    ('delivery_provider.provider_type', 'DIGIVIZE', 'Digivize', 2),
    ('delivery_provider.provider_type', 'OTHER_ESP', 'Other ESP', 3),
    ('delivery_provider.provider_type', 'OTHER_SMS', 'Other SMS', 4),
    ('delivery_provider.channel', 'EMAIL', 'Email', 1),
    ('delivery_provider.channel', 'SMS', 'SMS', 2),
    ('delivery_provider.channel', 'MMS', 'MMS', 3),
    ('sender_profile.channel', 'EMAIL', 'Email', 1),
    ('sender_profile.channel', 'SMS', 'SMS', 2),
    ('sender_profile.channel', 'MMS', 'MMS', 3),
    ('sender_profile.verification_status', 'PENDING', 'Pending', 1),
    ('sender_profile.verification_status', 'VERIFIED', 'Verified', 2),
    ('sender_profile.verification_status', 'FAILED', 'Failed', 3),
    ('dead_letter_message.channel', 'EMAIL', 'Email', 1),
    ('dead_letter_message.channel', 'SMS', 'SMS', 2),
    ('dead_letter_message.channel', 'MMS', 'MMS', 3),
    ('dead_letter_message.status', 'OPEN', 'Open', 1),
    ('dead_letter_message.status', 'RETRIED', 'Retried', 2),
    ('dead_letter_message.status', 'DISCARDED', 'Discarded', 3),
    ('definition_audit_log.action', 'INSERT', 'Insert', 1),
    ('definition_audit_log.action', 'UPDATE', 'Update', 2),
    ('definition_audit_log.action', 'DELETE', 'Delete', 3)
ON CONFLICT (code_set, code) DO NOTHING;

-- 9c. An index on every foreign-key column that is not already the leading column of an index or key
--     (PostgreSQL does not index FK columns automatically; missing ones make deletes and joins scan).
CREATE INDEX ix_role_permission_permission_id ON role_permission(permission_id);
CREATE INDEX ix_user_role_role_id ON user_role(role_id);
CREATE INDEX ix_contact_list_parent_contact_list_id ON contact_list(parent_contact_list_id);
CREATE INDEX ix_contact_list_member_contact_list_id ON contact_list_member(contact_list_id);
CREATE INDEX ix_contact_list_import_tenant_id ON contact_list_import(tenant_id);
CREATE INDEX ix_template_master_cloned_from_id ON template_master(cloned_from_id);
CREATE INDEX ix_personalization_tag_inner_template_id ON personalization_tag(inner_template_id);
CREATE INDEX ix_template_tag_tenant_id ON template_tag(tenant_id);
CREATE INDEX ix_receipt_presentation_model_tenant_id ON receipt_presentation_model(tenant_id);
CREATE INDEX ix_receipt_field_configuration_receipt_presentation_model_id ON receipt_field_configuration(receipt_presentation_model_id);
CREATE INDEX ix_campaign_template_id ON campaign(template_id);
CREATE INDEX ix_campaign_origin_journey_id ON campaign(origin_journey_id);
CREATE INDEX ix_campaign_owner_user_id ON campaign(owner_user_id);
CREATE INDEX ix_contact_list_campaign_contact_list_id ON contact_list_campaign(contact_list_id);
CREATE INDEX ix_contact_list_campaign_tenant_id ON contact_list_campaign(tenant_id);
CREATE INDEX ix_campaign_list_campaign_run_id ON campaign_list(campaign_run_id);
CREATE INDEX ix_campaign_list_tenant_id ON campaign_list(tenant_id);
CREATE INDEX ix_campaign_list_member_source_contact_list_id ON campaign_list_member(source_contact_list_id);
CREATE INDEX ix_campaign_target_campaign_id ON campaign_target(campaign_id);
CREATE INDEX ix_campaign_target_tenant_id ON campaign_target(tenant_id);
CREATE INDEX ix_campaign_actual_campaign_id ON campaign_actual(campaign_id);
CREATE INDEX ix_campaign_actual_tenant_id ON campaign_actual(tenant_id);
CREATE INDEX ix_journey_owner_user_id ON journey(owner_user_id);
CREATE INDEX ix_journey_current_version_id ON journey(current_version_id);
CREATE INDEX ix_journey_entry_rule_journey_version_id ON journey_entry_rule(journey_version_id);
CREATE INDEX ix_journey_connection_journey_version_id ON journey_connection(journey_version_id);
CREATE INDEX ix_journey_connection_from_node_id ON journey_connection(from_node_id);
CREATE INDEX ix_journey_connection_to_node_id ON journey_connection(to_node_id);
CREATE INDEX ix_journey_enrollment_journey_version_id ON journey_enrollment(journey_version_id);
CREATE INDEX ix_journey_customer_state_current_node_id ON journey_customer_state(current_node_id);
CREATE INDEX ix_journey_generated_campaign_journey_id ON journey_generated_campaign(journey_id);
CREATE INDEX ix_journey_generated_campaign_campaign_id ON journey_generated_campaign(campaign_id);
CREATE INDEX ix_journey_generated_campaign_tenant_id ON journey_generated_campaign(tenant_id);
CREATE INDEX ix_journey_generated_campaign_run_journey_generated_campaign_id ON journey_generated_campaign_run(journey_generated_campaign_id);
CREATE INDEX ix_journey_generated_campaign_run_campaign_run_id ON journey_generated_campaign_run(campaign_run_id);
CREATE INDEX ix_journey_generated_campaign_run_tenant_id ON journey_generated_campaign_run(tenant_id);
CREATE INDEX ix_communication_governance_policy_tenant_id ON communication_governance_policy(tenant_id);
CREATE INDEX ix_governance_exemption_policy_id ON governance_exemption(policy_id);
CREATE INDEX ix_consent_suppression_preferred_contact_point_id ON consent_suppression(preferred_contact_point_id);
CREATE INDEX ix_sender_profile_delivery_provider_id ON sender_profile(delivery_provider_id);
CREATE INDEX ix_template_media_asset_media_asset_id ON template_media_asset(media_asset_id);

-- 9d. Natural keys: no two live definitions with the same name in a tenant (soft-deleted rows do not block reuse).
CREATE UNIQUE INDEX ux_template_master_name_live ON template_master(tenant_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_journey_name_live ON journey(tenant_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_contact_list_name_live ON contact_list(tenant_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_communication_governance_policy_name_live ON communication_governance_policy(tenant_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_receipt_presentation_model_name_live ON receipt_presentation_model(tenant_id, name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_role_name_live ON role(tenant_id, name) WHERE deleted_at IS NULL;

-- 9e. updated_at maintenance for the tables created in this layer.
CREATE TRIGGER trg_delivery_provider_touch BEFORE UPDATE ON delivery_provider FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_sender_profile_touch BEFORE UPDATE ON sender_profile FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_media_asset_touch BEFORE UPDATE ON media_asset FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_reference_code_touch BEFORE UPDATE ON reference_code FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- =====================================================================================
-- End of enterprise hardening layer.
-- =====================================================================================
