-- =====================================================================================
-- AI-InteleKt Customer Engagement Platform (CEP) — MVP Physical Database Design
-- Target: PostgreSQL 18+
-- Derived from: AI-InteleKt_CEP_Functional_BRD_Integration_Design_Baseline_v0.9_R3_CLEAN.docx
--               (Appendix A — MVP Logical Data Model, Entity Ownership Matrix, A.3 Core
--               Logical Relationships) and CEP_Technology_Stack_Option_B_Django_Modular_
--               Monolith.docx / Framework for CEP.docx (Django 5 + DRF, Celery, Redis,
--               PostgreSQL 18+, partitioning guidance).
--
-- Read this alongside CEP_Database_Design.md for rationale, domain grouping, partitioning
-- and indexing strategy, and the BRD traceability table.
--
-- Conventions:
--   * UUID surrogate keys (gen_random_uuid()) for all normalized/operational entities —
--     Django-friendly, safe for eventual service extraction (BRD strangler-fig direction).
--   * BIGINT IDENTITY surrogate keys for high-volume PARTITIONED execution/event tables,
--     where UUID index bloat and random insert order would hurt partition-local performance.
--   * tenant_id present on every table — CEP is SaaS from day one. Small tenants share a pool
--     database; every high-volume table is PARTITION BY LIST (tenant_id) with per-tenant
--     sub-partitions (monthly RANGE, or HASH for list membership), so a tenant's data can be
--     detached and moved to a DEDICATED database when its volume justifies it. Partition
--     provisioning, retention and tenant migration live in CEP_Database_Schema_SaaS_Tenancy.sql.
--   * JSONB used only where the BRD explicitly calls for extensibility: custom contact/
--     campaign-list attributes, segment/journey rule definitions, GrapesJS/MJML editor
--     state, receipt layout/field configuration, journey node config, webhook raw payload.
--   * party_id is the canonical customer key end to end (C360-owned), declared VARCHAR(60)
--     to match the confirmed physical type in the existing iCRM (Apache OFBiz-based)
--     `party`/`person`/`mailer_master`/`contact_list_party` tables inspected during design —
--     see CEP_Database_Design.md §8 for the full reconciliation.
-- =====================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email columns

-- =====================================================================================
-- 0. TENANCY, IDENTITY & ACCESS  (apps/tenants, apps/identity, apps/permissions)
-- =====================================================================================

CREATE TABLE tenant (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    code                VARCHAR(50)  NOT NULL UNIQUE,
    timezone            VARCHAR(64)  NOT NULL DEFAULT 'UTC',
    status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE app_user (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    email               CITEXT NOT NULL,
    display_name        VARCHAR(200) NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    auth_provider       VARCHAR(20) NOT NULL DEFAULT 'LOCAL', -- LOCAL, SAML, OIDC
    external_subject_id VARCHAR(255),                   -- IdP subject / NameID for SSO users
    mfa_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    password_hash       VARCHAR(255),                   -- Django PBKDF2/Argon2 hash; NULL for SSO-only users
    is_staff            BOOLEAN NOT NULL DEFAULT FALSE, -- may use Django Admin (internal ops)
    is_platform_admin   BOOLEAN NOT NULL DEFAULT FALSE, -- cross-tenant platform operator (superuser)
    UNIQUE (email),                                 -- globally unique: the login identity (Django USERNAME_FIELD); a user row belongs to exactly one tenant
    UNIQUE (tenant_id, auth_provider, external_subject_id)
);

CREATE TABLE role (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(100) NOT NULL,
    description         TEXT,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE permission (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                VARCHAR(100) NOT NULL UNIQUE,   -- e.g. campaign.publish, journey.activate
    description         TEXT,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permission (
    role_id             UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    permission_id       UUID NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_role (
    user_id             UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id             UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

-- =====================================================================================
-- 1. CUSTOMER & SEGMENT  (apps/customers)
-- BRD: C360 is authoritative. Customer Master here is an OPTIONAL, NON-AUTHORITATIVE,
-- synchronized copy (TD-02) — prefer the fast Customer Master API where possible. Segment
-- likewise is a cached reference, not owned/edited by CEP (do not rebuild segmentation).
-- =====================================================================================

CREATE TABLE customer_master (
    party_id            VARCHAR(60) PRIMARY KEY,              -- canonical key, sourced from C360
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    first_name          VARCHAR(120),
    last_name           VARCHAR(120),
    emails              JSONB NOT NULL DEFAULT '[]',   -- [{address, is_primary, is_valid}]
    phones              JSONB NOT NULL DEFAULT '[]',   -- [{number, type, is_primary}]
    primary_address     JSONB,
    custom_attributes   JSONB NOT NULL DEFAULT '{}',   -- loyalty tier, RFM/CLV, etc.
    source_system       VARCHAR(40) NOT NULL DEFAULT 'C360',
    is_synced_copy      BOOLEAN NOT NULL DEFAULT TRUE,  -- always TRUE per TD-02; kept explicit
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_customer_master_tenant ON customer_master(tenant_id);
CREATE INDEX ix_customer_master_emails ON customer_master USING GIN (emails);
COMMENT ON TABLE customer_master IS
  'Non-authoritative synchronized copy of the C360 denormalized Customer Master (BRD TD-02). '
  'Prefer the Customer Master API; this table exists only where performance, isolation, or '
  'external campaign-system integration requires a local copy.';

CREATE TABLE segment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    source_system       VARCHAR(40) NOT NULL DEFAULT 'C360',
    code                VARCHAR(100) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    rule_definition     JSONB,                          -- rule-based definition, if exposed
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, source_system, code)
);

CREATE TABLE customer_segment_membership (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    segment_id          UUID NOT NULL REFERENCES segment(id),
    qualified_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (segment_id, party_id)
);
CREATE INDEX ix_seg_membership_party ON customer_segment_membership(tenant_id, party_id);

-- =====================================================================================
-- 2. CONTACT LIST  (apps/contact_lists)
-- BRD 6.2: reusable population from BI / extraction tool / upload; may attach to many
-- Campaigns; changes do not retroactively affect an already-created Campaign List.
-- =====================================================================================

CREATE TABLE contact_list (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    legacy_contact_list_id VARCHAR(60) UNIQUE,          -- iCRM contact_list.CONTACT_LIST_ID, where this list is reused/migrated rather than newly created
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    source_type         VARCHAR(20) NOT NULL,           -- BI, EXTRACTION, UPLOAD, SEGMENT
    source_reference    VARCHAR(300),                   -- BI job id / file name / segment id
    list_kind           VARCHAR(20) NOT NULL DEFAULT 'STATIC', -- STATIC (uploaded), DYNAMIC (rule, materialised on refresh), SEGMENT (C360 segment), DERIVED (filter over a parent, resolved at campaign build — never copied)
    is_master           BOOLEAN NOT NULL DEFAULT TRUE,  -- master lists are the reusable populations attached to campaigns
    parent_contact_list_id UUID REFERENCES contact_list(id),
    criteria            JSONB,                          -- DYNAMIC / DERIVED rule evaluated by the audience worker (iCRM contact_list.CRITERIA)
    refresh_mode        VARCHAR(20) NOT NULL DEFAULT 'MANUAL', -- MANUAL, SCHEDULED, ON_CAMPAIGN_BUILD
    refresh_interval_minutes INTEGER,
    last_refreshed_at   TIMESTAMPTZ,
    list_environment     VARCHAR(20) NOT NULL DEFAULT 'PRODUCTION', -- TEST, PRODUCTION
    status              VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    member_count        INTEGER NOT NULL DEFAULT 0,     -- maintained by import worker
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_contact_list_tenant ON contact_list(tenant_id, status);

CREATE TABLE contact_list_member (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    contact_list_id     UUID NOT NULL REFERENCES contact_list(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    custom_attributes   JSONB NOT NULL DEFAULT '{}',
    membership_source   VARCHAR(20) NOT NULL DEFAULT 'UPLOAD', -- UPLOAD, RULE, SEGMENT, MANUAL
    matched_by          VARCHAR(20),                    -- LOYALTY_ID, EMAIL, PHONE, PARTY_ID — identity-resolution method at import
    import_id           UUID,                           -- contact_list_import that created the row (no FK: partitioned high-volume table)
    added_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, contact_list_id)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned HASH (contact_list_id) x 8) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE UNIQUE INDEX ux_contact_list_member ON contact_list_member(tenant_id, contact_list_id, party_id);
CREATE INDEX ix_contact_list_member_party ON contact_list_member(tenant_id, party_id);

CREATE TABLE contact_list_import (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    contact_list_id     UUID NOT NULL REFERENCES contact_list(id),
    file_name           VARCHAR(255) NOT NULL,
    storage_key         VARCHAR(500),                   -- object-store key of the uploaded file (private prefix)
    status              VARCHAR(20) NOT NULL DEFAULT 'UPLOADED', -- UPLOADED, MATCHING, REVIEW, APPLIED, FAILED
    match_rules         JSONB NOT NULL DEFAULT '["LOYALTY_ID", "EMAIL", "PHONE"]', -- identity-resolution order against customer_master
    row_count           INTEGER NOT NULL DEFAULT 0,
    matched_count       INTEGER NOT NULL DEFAULT 0,
    unmatched_count     INTEGER NOT NULL DEFAULT 0,
    duplicate_count     INTEGER NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX ix_contact_list_import_list ON contact_list_import(contact_list_id, status);

-- Staging: every uploaded row is matched to a party_id BEFORE it can become a contact_list_member,
-- so the same person uploaded twice (or with a different email) resolves to one membership. HIGH VOLUME, transient.
CREATE TABLE contact_list_import_row (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    import_id           UUID NOT NULL,
    tenant_id           UUID NOT NULL,
    row_number          INTEGER NOT NULL,
    raw                 JSONB NOT NULL,                 -- the uploaded row as received
    matched_party_id    VARCHAR(60),
    match_status        VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, MATCHED, UNMATCHED, DUPLICATE, REJECTED
    match_method        VARCHAR(20),                    -- LOYALTY_ID, EMAIL, PHONE, PARTY_ID
    error_message       VARCHAR(300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, created_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (created_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_contact_list_import_row_import ON contact_list_import_row(import_id, match_status);

-- =====================================================================================
-- 3. TEMPLATE STUDIO  (apps/templates)
-- BRD 9-10: one Template Master per channel identity; GrapesJS/MJML editable state retained
-- separately from send-ready rendered content; E-Receipt = outer template + inner receipt
-- presentation component with field-level configuration.
-- =====================================================================================

CREATE TABLE template_master (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    description         TEXT,                           -- iCRM DESCRIPTION / USE_OF_TEMPLATE
    legacy_template_id  VARCHAR(60) UNIQUE,             -- iCRM template_master.TEMPLATE_ID, for templates carried over rather than authored fresh in Template Studio
    name                VARCHAR(200) NOT NULL,
    channel             VARCHAR(20) NOT NULL,           -- EMAIL, E_RECEIPT, SMS, MMS
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ACTIVE, ARCHIVED
    cloned_from_id      UUID REFERENCES template_master(id),
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_template_master_tenant ON template_master(tenant_id, channel, status);

CREATE TABLE template_design_state (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    editor_state        JSONB NOT NULL,                 -- GrapesJS/MJML editable project state
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version_number)
);

CREATE TABLE rendered_template_content (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    version_number      INTEGER NOT NULL,
    subject_line        VARCHAR(300),                    -- default subject for EMAIL / E_RECEIPT; may contain {{tags}}; run variants can override (TD-04)
    preheader           VARCHAR(300),                    -- inbox preview text shown after the subject
    html_content        TEXT,
    text_content        TEXT,
    mjml_source         TEXT,
    sms_body            TEXT,                            -- for SMS/MMS channel templates
    rendered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version_number)
);

-- Tag catalogue: STANDARD tags resolve from a known entity/field, CUSTOM tags from campaign-time custom value pairs,
-- INNER_TEMPLATE tags expand a block template (e-receipt body, "also bought"), SYSTEM tags are computed (unsubscribe URL, barcode).
-- Render-time resolution order: SYSTEM -> CAMPAIGN -> CAMPAIGN_LIST_MEMBER custom pair -> CUSTOMER_MASTER -> default_value;
-- a mandatory tag still empty suppresses the recipient rather than sending a blank. (iCRM: data_tag_configuration)
CREATE TABLE personalization_tag (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    legacy_tag_id       VARCHAR(60),                    -- iCRM data_tag_configuration.TAG_ID (116-row vocabulary loads 1:1)
    tag_key             VARCHAR(100) NOT NULL,           -- e.g. {{first_name}}
    label               VARCHAR(150) NOT NULL,           -- shown in Template Studio (iCRM TAG_NAME)
    tag_kind            VARCHAR(20) NOT NULL DEFAULT 'STANDARD', -- STANDARD, CUSTOM, INNER_TEMPLATE, SEGMENT, SYSTEM
    source_system       VARCHAR(40) NOT NULL,            -- C360, CEP
    resolution_source   VARCHAR(30) NOT NULL,            -- CUSTOMER_MASTER, CAMPAIGN_LIST_MEMBER, CAMPAIGN, CAMPAIGN_RUN, STORE, SYSTEM, STATIC, INNER_TEMPLATE, RECEIPT
    source_path         VARCHAR(200),                    -- e.g. first_name / custom_value_pairs.discount_pct / name (iCRM ENTITY_FIELD_NAME, CUSTOM_FIELD_ID)
    static_value        TEXT,                            -- STATIC tags (iCRM DATA_TAG_VALUE)
    default_value       TEXT,                            -- fallback when the source is empty
    format_spec         VARCHAR(60),                     -- date / number / currency pattern applied at render
    inner_template_id   UUID REFERENCES template_master(id), -- INNER_TEMPLATE tags expand this block template
    data_type           VARCHAR(20) NOT NULL DEFAULT 'STRING',
    applies_to_channels TEXT[] NOT NULL DEFAULT '{EMAIL,E_RECEIPT,SMS,MMS}',
    description         TEXT,
    sample_value        TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, tag_key)
);
CREATE INDEX ix_personalization_tag_kind ON personalization_tag(tenant_id, tag_kind) WHERE is_active;

-- Which tags a template uses (parsed from the editor content on save). Mandatory CUSTOM tags are validated against the
-- campaign list's custom_value_pairs at publish time. (iCRM: template_tag, 3,870 rows)
CREATE TABLE template_tag (
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    tag_id              UUID NOT NULL REFERENCES personalization_tag(id),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    is_mandatory        BOOLEAN NOT NULL DEFAULT FALSE,  -- iCRM TAG_MANDATORY
    sequence            INTEGER NOT NULL DEFAULT 0,      -- iCRM TAG_SEQUENCE
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (template_id, tag_id)
);
CREATE INDEX ix_template_tag_tag ON template_tag(tag_id);

CREATE TABLE receipt_presentation_model (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(150) NOT NULL,
    layout_type         VARCHAR(30) NOT NULL,            -- POS, ENHANCED_RETAIL, ECOMMERCE, HYBRID
    layout_definition   JSONB NOT NULL,                  -- section/column structure
    is_standard         BOOLEAN NOT NULL DEFAULT TRUE,   -- OOTB vs. client-custom
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE receipt_field_configuration (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         UUID NOT NULL REFERENCES template_master(id) ON DELETE CASCADE,
    receipt_presentation_model_id UUID NOT NULL REFERENCES receipt_presentation_model(id),
    field_key           VARCHAR(100) NOT NULL,           -- SKU, Description, Qty, UnitPrice, ...
    section             VARCHAR(30) NOT NULL,            -- HEADER, ITEM_LINE, DISCOUNT, TAX, TOTALS, TENDER
    visible             BOOLEAN NOT NULL DEFAULT TRUE,
    label_override      VARCHAR(150),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    column_group        VARCHAR(50),
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, field_key)
);

-- =====================================================================================
-- 4. CAMPAIGN & EXECUTION  (apps/campaigns, apps/campaign_runs, apps/economics)
-- BRD 7: Campaign = universal execution container; Campaign Run = discrete batch beneath
-- it, purposefully generic so Phase II subject-line variants (TD-04) don't force a redesign.
-- =====================================================================================

CREATE TABLE campaign (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    legacy_marketing_campaign_id VARCHAR(60) UNIQUE,    -- iCRM marketing_campaign.MARKETING_CAMPAIGN_ID, where reconciling against pre-CEP campaign history
    name                VARCHAR(200) NOT NULL,
    campaign_type       VARCHAR(20) NOT NULL,            -- REGULAR_MARKETING, E_RECEIPT, DRIP, JOURNEY, OTHER
    channel             VARCHAR(20) NOT NULL,             -- EMAIL, SMS, MMS, MULTI
    status              VARCHAR(30) NOT NULL DEFAULT 'DRAFT', -- DRAFT, TEST_PUBLISHED, PRODUCTION_PUBLISHED, ACTIVE, COMPLETED, CANCELLED
    solicitation_type   VARCHAR(20) NOT NULL DEFAULT 'MARKETING', -- MARKETING (consent + caps + unsubscribe), TRANSACTIONAL (valid contact point only, cap-exempt), SERVICE, LEGAL (iCRM DND_REQUIRED)
    template_id         UUID REFERENCES template_master(id),
    origin_journey_id   UUID,                             -- FK added after journey table exists (below)
    is_journey_generated BOOLEAN NOT NULL DEFAULT FALSE,   -- journey-generated campaigns are not manually edited (BRD 7.3)
    owner_user_id       UUID REFERENCES app_user(id),
    scheduled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    description         TEXT,                             -- iCRM CAMPAIGN_SUMMARY
    code                VARCHAR(40) NOT NULL -- human-readable business key, e.g. CMP-2026-00042 (iCRM CAMPAIGN_CODE); used in reporting and attribution
);
CREATE INDEX ix_campaign_tenant_status ON campaign(tenant_id, status);
CREATE UNIQUE INDEX ux_campaign_code ON campaign(tenant_id, code);

CREATE TABLE campaign_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    run_number          INTEGER NOT NULL,
    run_type            VARCHAR(30) NOT NULL,             -- ONE_TIME, RECURRING_INSTANCE, DRIP_INSTANCE, JOURNEY_INSTANCE, ERECEIPT_INSTANCE
    status              VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, PREPARING, SENDING, COMPLETED, FAILED, CANCELLED
    test_mode           BOOLEAN NOT NULL DEFAULT FALSE,
    scheduled_at        TIMESTAMPTZ,
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, run_number)
);
CREATE INDEX ix_campaign_run_tenant_status ON campaign_run(tenant_id, status);

-- Future-proofing for Phase II subject-line / content experimentation (TD-04, Appendix B).
-- Unused by MVP send logic (single implicit variant covers 100% of the run) but present so
-- the winner-rollout pattern does not require a schema migration to introduce later.
CREATE TABLE campaign_run_variant (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_run_id     UUID NOT NULL REFERENCES campaign_run(id) ON DELETE CASCADE,
    variant_key         VARCHAR(20) NOT NULL DEFAULT 'A',
    subject_line        VARCHAR(300),
    allocation_pct      NUMERIC(5,2) NOT NULL DEFAULT 100.00,
    is_winner           BOOLEAN,
    winner_metric        VARCHAR(30),                     -- OPEN_RATE, CLICK_RATE, CONVERSION_RATE
    metric_value         NUMERIC(10,4),
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_run_id, variant_key)
);

CREATE TABLE contact_list_campaign (            -- Campaign <-> Contact List (many-to-many)
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    contact_list_id     UUID NOT NULL REFERENCES contact_list(id),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    attached_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (campaign_id, contact_list_id)
);

CREATE TABLE campaign_list (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_campaign_list_id VARCHAR(60),                -- iCRM marketing_campaign_contact_list.CAMPAIGN_LIST_ID
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    campaign_run_id     UUID REFERENCES campaign_run(id),  -- set when a Journey/drip generates a fresh list per run
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'BUILDING', -- BUILDING, FROZEN, FAILED
    dedup_strategy      VARCHAR(30) NOT NULL DEFAULT 'PARTY_ID_LAST_WINS',
    member_count        INTEGER NOT NULL DEFAULT 0,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_campaign_list_campaign ON campaign_list(campaign_id);

CREATE TABLE campaign_list_member (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    campaign_list_id    UUID NOT NULL,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    source_contact_list_id UUID REFERENCES contact_list(id),
    custom_value_pairs  JSONB NOT NULL DEFAULT '{}',      -- campaign-time extensible attributes (BRD 6.3)
    segment_codes       TEXT[] NOT NULL DEFAULT '{}',
    status              VARCHAR(20) NOT NULL DEFAULT 'ELIGIBLE', -- ELIGIBLE, SUPPRESSED, SENT
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, created_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (created_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE UNIQUE INDEX ux_campaign_list_member ON campaign_list_member(tenant_id, campaign_list_id, party_id, created_at);
CREATE INDEX ix_campaign_list_member_party ON campaign_list_member(tenant_id, party_id);

CREATE TABLE campaign_target (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    target_revenue      NUMERIC(14,2),
    target_opens        INTEGER,
    target_clicks       INTEGER,
    target_conversions  INTEGER,
    target_redemptions  INTEGER,
    planned_cost        NUMERIC(14,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_actual (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         UUID NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    actual_delivery_cost NUMERIC(14,2),
    offer_cost           NUMERIC(14,2),
    attributed_revenue    NUMERIC(14,2),
    attributed_orders     INTEGER,
    attributed_conversions INTEGER,
    campaign_contribution  NUMERIC(14,2),   -- attributed_revenue - (delivery_cost + offer_cost); NOT accounting profit
    campaign_roi            NUMERIC(10,4),
    revenue_per_delivered    NUMERIC(10,4),
    cost_per_conversion       NUMERIC(10,4),
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================================
-- 5. JOURNEY ORCHESTRATION  (apps/journeys)
-- BRD 11: independent of Campaign; a communication node creates/invokes a grouped
-- Campaign/Run/List for the eligible population reached in an execution window — never
-- one Campaign per customer.
-- =====================================================================================

CREATE TABLE journey (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(200) NOT NULL,
    description         TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, TEST, ACTIVE, PAUSED, ARCHIVED
    population_mode     VARCHAR(30) NOT NULL,            -- FIXED, CONTINUOUSLY_QUALIFYING, EVENT_TRIGGERED
    reentry_policy       VARCHAR(30) NOT NULL DEFAULT 'NEVER', -- NEVER, AFTER_X_DAYS, EVERY_QUALIFYING_EVENT
    reentry_after_days    INTEGER,
    owner_user_id          UUID REFERENCES app_user(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    code                VARCHAR(40) NOT NULL -- human-readable business key, e.g. JRN-2026-00007
);
CREATE INDEX ix_journey_tenant_status ON journey(tenant_id, status);
CREATE UNIQUE INDEX ux_journey_code ON journey(tenant_id, code);

ALTER TABLE campaign ADD CONSTRAINT fk_campaign_origin_journey
    FOREIGN KEY (origin_journey_id) REFERENCES journey(id);

CREATE TABLE journey_version (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id          UUID NOT NULL REFERENCES journey(id) ON DELETE CASCADE,
    version_number       INTEGER NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, TEST_PUBLISHED, ACTIVE, RETIRED
    definition_snapshot   JSONB,                          -- full node/connection graph snapshot at publish time
    published_at           TIMESTAMPTZ,
    created_by              UUID REFERENCES app_user(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (journey_id, version_number)
);
ALTER TABLE journey ADD COLUMN current_version_id UUID REFERENCES journey_version(id);

CREATE TABLE journey_entry_rule (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_version_id  UUID NOT NULL REFERENCES journey_version(id) ON DELETE CASCADE,
    entry_type          VARCHAR(30) NOT NULL,             -- CUSTOMER_LIST, EVENT, DATE_TIME, SEGMENT_CHANGE
    rule_definition      JSONB NOT NULL,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journey_node (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_version_id  UUID NOT NULL REFERENCES journey_version(id) ON DELETE CASCADE,
    node_key             VARCHAR(100) NOT NULL,            -- stable key within the version's graph
    node_family           VARCHAR(20) NOT NULL,             -- ENTRY, LOGIC, COMMUNICATION, ACTION, CONTROL
    node_type              VARCHAR(40) NOT NULL,             -- CONDITION, WAIT, SPLIT, EMAIL, SMS, COUPON_ISSUE, LOYALTY_CHANGE, SEGMENT_UPDATE, EXIT, ...
    config                   JSONB NOT NULL DEFAULT '{}',      -- wait duration, condition expr, template_id, action params...
    canvas_position          JSONB,                             -- {x,y} for builder UI
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (journey_version_id, node_key)
);

CREATE TABLE journey_connection (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_version_id  UUID NOT NULL REFERENCES journey_version(id) ON DELETE CASCADE,
    from_node_id         UUID NOT NULL REFERENCES journey_node(id) ON DELETE CASCADE,
    to_node_id             UUID NOT NULL REFERENCES journey_node(id) ON DELETE CASCADE,
    branch_key              VARCHAR(50),                        -- e.g. 'YES' / 'NO' / 'A' / 'B'
    condition_label           VARCHAR(200),
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journey_enrollment (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id          UUID NOT NULL REFERENCES journey(id),
    journey_version_id  UUID NOT NULL REFERENCES journey_version(id),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, EXITED, COMPLETED
    enrolled_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    exited_at              TIMESTAMPTZ,
    exit_reason              VARCHAR(100),
    converted_at             TIMESTAMPTZ,              -- the Goal step: the first matching event's moment (apps/journeys/goals.py)
    converted_node_id        UUID,                     -- the Goal step reached (journey_node.id)
    attributed_revenue       NUMERIC(14,2)             -- the matching events' amounts within the goal's window
);
CREATE INDEX ix_journey_enrollment_party ON journey_enrollment(tenant_id, party_id);
CREATE INDEX ix_journey_enrollment_journey_status ON journey_enrollment(journey_id, status);
-- Enforce re-entry policy at the DB layer for the NEVER case (application enforces AFTER_X_DAYS / EVERY_QUALIFYING_EVENT):
CREATE UNIQUE INDEX ux_journey_enrollment_no_reentry ON journey_enrollment(journey_id, party_id)
    WHERE status = 'ACTIVE';

CREATE TABLE journey_customer_state (
    journey_enrollment_id UUID PRIMARY KEY REFERENCES journey_enrollment(id) ON DELETE CASCADE,
    current_node_id         UUID REFERENCES journey_node(id),
    entered_node_at            TIMESTAMPTZ,
    next_scheduled_at            TIMESTAMPTZ,             -- drives the "due transitions" poller (no open worker waits)
    state_data                     JSONB NOT NULL DEFAULT '{}',
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_journey_customer_state_due ON journey_customer_state(next_scheduled_at)
    WHERE next_scheduled_at IS NOT NULL;

-- HIGH VOLUME — partitioned monthly.
CREATE TABLE journey_node_execution (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    journey_enrollment_id UUID NOT NULL,
    journey_node_id       UUID NOT NULL,
    tenant_id               UUID NOT NULL,
    party_id                 VARCHAR(60) NOT NULL,
    execution_status           VARCHAR(20) NOT NULL,       -- SUCCESS, FAILED, SKIPPED
    result_data                  JSONB,
    generated_campaign_run_id      UUID,                    -- set on COMMUNICATION nodes that generated a run
    executed_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, executed_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (executed_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_jne_enrollment ON journey_node_execution(journey_enrollment_id);
CREATE INDEX ix_jne_tenant_party ON journey_node_execution(tenant_id, party_id);

-- HIGH VOLUME — inbound trigger events (purchase, cart abandon, coupon, engagement, etc.)
-- feeding journey entry rules and conditions. Partitioned monthly.
CREATE TABLE journey_event (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    party_id             VARCHAR(60) NOT NULL,
    event_type             VARCHAR(60) NOT NULL,           -- PURCHASE, CATEGORY_PURCHASE, CART_ABANDON, COUPON_ISSUED, COUPON_REDEEMED, EMAIL_OPEN, EMAIL_CLICK, SMS_RESPONSE, SEGMENT_CHANGE, LOYALTY_TIER_CHANGE, ...
    event_source            VARCHAR(40) NOT NULL,           -- C360, POSTAL, DIGIVIZE, COMMERCE, LOYALTY
    event_payload              JSONB NOT NULL DEFAULT '{}',
    occurred_at                  TIMESTAMPTZ NOT NULL,
    ingested_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, occurred_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (occurred_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_journey_event_party_type ON journey_event(tenant_id, party_id, event_type);

CREATE TABLE journey_generated_campaign (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_id          UUID NOT NULL REFERENCES journey(id),
    journey_node_id      UUID NOT NULL REFERENCES journey_node(id),
    campaign_id             UUID NOT NULL REFERENCES campaign(id),
    tenant_id                 UUID NOT NULL REFERENCES tenant(id),
    generation_date              DATE NOT NULL,           -- supports the daily-aggregation default window
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (journey_node_id, generation_date)               -- one grouped campaign per node per window by default
);

CREATE TABLE journey_generated_campaign_run (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journey_generated_campaign_id UUID NOT NULL REFERENCES journey_generated_campaign(id) ON DELETE CASCADE,
    campaign_run_id       UUID NOT NULL REFERENCES campaign_run(id),
    tenant_id                UUID NOT NULL REFERENCES tenant(id),
    execution_window_start     TIMESTAMPTZ NOT NULL,
    execution_window_end          TIMESTAMPTZ NOT NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================================
-- 6. CORPORATE COMMUNICATION GOVERNANCE  (apps/governance)
-- BRD 12: cross-campaign / cross-journey frequency, consent, suppression, priority,
-- and transactional/e-receipt exemption.
-- =====================================================================================

CREATE TABLE communication_governance_policy (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(200) NOT NULL,
    scope                VARCHAR(20) NOT NULL,             -- GLOBAL, CHANNEL, CAMPAIGN_TYPE
    channel                VARCHAR(20),                      -- EMAIL, SMS, MMS (null = ALL)
    max_messages              INTEGER NOT NULL,
    period_days                 INTEGER NOT NULL,
    applies_to                    VARCHAR(20) NOT NULL DEFAULT 'MARKETING', -- MARKETING, ALL
    priority                        INTEGER NOT NULL DEFAULT 100,
    soft_bounce_threshold           INTEGER,                  -- GLOBAL policy: soft bounces within the window that block a contact point (e.g. 3)
    soft_bounce_window_days         INTEGER,                  -- e.g. 30
    is_active                         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE governance_exemption (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id            UUID NOT NULL REFERENCES communication_governance_policy(id) ON DELETE CASCADE,
    exemption_type          VARCHAR(30) NOT NULL,           -- TRANSACTIONAL, E_RECEIPT, VIP, MANUAL_OVERRIDE
    criteria                   JSONB,
    created_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contact-point health: one row per email address / phone number, shared by every campaign. Bounces and complaints are
-- facts about an ADDRESS, so a hard bounce learned in campaign A blocks the address for campaign B.
-- (iCRM: party_contact_blacklist, marketing_campaign_black_list_mail, dnd_master — which is number-only, hence nullable party_id)
CREATE TABLE contact_point_status (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    contact_point_type  VARCHAR(10) NOT NULL,            -- EMAIL, PHONE
    contact_value       CITEXT NOT NULL,                 -- normalised address / E.164 number
    party_id            VARCHAR(60),                     -- NULL for registry / list-imported numbers with no known party
    is_valid            BOOLEAN NOT NULL DEFAULT TRUE,   -- syntax / MX / carrier validation
    hard_bounce_count   INTEGER NOT NULL DEFAULT 0,
    soft_bounce_count   INTEGER NOT NULL DEFAULT 0,
    last_bounce_at      TIMESTAMPTZ,
    last_bounce_reason  VARCHAR(200),                    -- DSN status / provider reason
    complaint_count     INTEGER NOT NULL DEFAULT 0,
    last_complaint_at   TIMESTAMPTZ,
    blocked             BOOLEAN NOT NULL DEFAULT FALSE,
    block_reason        VARCHAR(30),                     -- HARD_BOUNCE, SOFT_BOUNCE_THRESHOLD, COMPLAINT, MANUAL, DND_REGISTRY, INVALID, GLOBAL_SUPPRESSION_LIST
    block_source        VARCHAR(40),                     -- POSTAL, DIGIVIZE, CSR, IMPORT, C360
    blocked_at          TIMESTAMPTZ,
    unblocked_at        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, contact_point_type, contact_value)
);
CREATE INDEX ix_contact_point_party ON contact_point_status(tenant_id, party_id);
CREATE INDEX ix_contact_point_blocked ON contact_point_status(tenant_id, contact_point_type) WHERE blocked;

-- Current consent + stored marketability per party per channel. Derived from consent_record (the proof) and
-- contact_point_status (the address); maintained by the webhook / consent workers so list building is one indexed join.
CREATE TABLE consent_suppression (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id             VARCHAR(60) NOT NULL,
    channel                VARCHAR(20) NOT NULL,
    consent_status           VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN', -- OPTED_IN, OPTED_OUT, UNKNOWN
    opted_in_at                TIMESTAMPTZ,
    opted_out_at               TIMESTAMPTZ,
    opt_out_method             VARCHAR(30),             -- UNSUBSCRIBE_LINK, SMS_STOP, PREFERENCE_CENTER, CSR, IMPORT, COMPLAINT
    suppressed                 BOOLEAN NOT NULL DEFAULT FALSE,
    suppression_reason             VARCHAR(200),
    preferred_contact_point_id     UUID REFERENCES contact_point_status(id),
    marketable                     BOOLEAN NOT NULL DEFAULT FALSE, -- consent OPTED_IN AND NOT suppressed AND preferred contact point NOT blocked
    marketable_reason              VARCHAR(40),          -- why not: NO_CONSENT, UNSUBSCRIBED, SMS_STOP, HARD_BOUNCE, SOFT_BOUNCE_THRESHOLD, COMPLAINT, DND_REGISTRY, MANUAL_BLOCK, INVALID_ADDRESS, GLOBAL_SUPPRESSION_LIST
    last_consent_record_id         BIGINT,
    source_system                     VARCHAR(40) NOT NULL DEFAULT 'C360',
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, party_id, channel)
);
CREATE INDEX ix_consent_marketable ON consent_suppression(tenant_id, channel) WHERE marketable;

-- Append-only consent proof: every opt-in / opt-out with its source and evidence. Retained indefinitely (legal).
-- contact_list_id is reserved for per-list preferences (preference centre); MVP consent is per channel.
-- (iCRM: suppression_block_detail, contact_list_party_status incl. OPT_IN_VERIFY_CODE)
CREATE TABLE consent_record (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    party_id            VARCHAR(60) NOT NULL,
    channel             VARCHAR(20) NOT NULL,            -- EMAIL, SMS, MMS
    action              VARCHAR(30) NOT NULL,            -- OPT_IN, DOUBLE_OPT_IN_CONFIRMED, OPT_OUT, RESUBSCRIBE
    source              VARCHAR(30) NOT NULL,            -- WEB_FORM, POS, IMPORT, UNSUBSCRIBE_LINK, SMS_STOP, PREFERENCE_CENTER, CSR, C360_SYNC, COMPLAINT, LEGAL
    evidence            JSONB NOT NULL DEFAULT '{}',     -- ip, user agent, form id, verification code, provider event id
    campaign_id         UUID,
    campaign_run_id     UUID,
    mailer_execution_id BIGINT,                          -- the message whose link / reply carried the action
    sms_execution_id    BIGINT,
    contact_list_id     UUID,                            -- reserved: per-list preference
    occurred_at         TIMESTAMPTZ NOT NULL,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, occurred_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (occurred_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_consent_record_party ON consent_record(tenant_id, party_id, channel, occurred_at);

-- HIGH VOLUME — one row per governance check performed during send preparation. Partitioned monthly.
CREATE TABLE governance_evaluation_log (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    party_id             VARCHAR(60) NOT NULL,
    campaign_id           UUID NOT NULL,
    campaign_run_id         UUID,
    journey_id                 UUID,
    channel                       VARCHAR(20) NOT NULL,
    policy_id                       UUID,
    decision                           VARCHAR(10) NOT NULL,   -- ALLOW, SUPPRESS
    reason                                VARCHAR(200),
    evaluated_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, evaluated_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (evaluated_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_gov_eval_campaign_run ON governance_evaluation_log(campaign_run_id);

-- =====================================================================================
-- 7. CHANNEL EXECUTION — MAILER MASTER / SMS MASTER  (apps/delivery, apps/postal, apps/digivize)
-- BRD 8 / TD-01: deliberately kept as SEPARATE channel execution masters for MVP instead of
-- a unified Campaign Recipient model. Identifiers (party_id, campaign_id, campaign_run_id,
-- campaign_list_member id) are kept stable so a later migration to a common
-- Campaign Recipient + channel-child model does not change business semantics.
-- Both tables are HIGH VOLUME — partitioned monthly, idempotency-keyed for safe retries.
-- =====================================================================================

CREATE TABLE mailer_execution (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    campaign_id         UUID NOT NULL,
    campaign_run_id     UUID NOT NULL,
    campaign_list_member_id BIGINT,
    party_id            VARCHAR(60) NOT NULL,
    email_address        CITEXT NOT NULL,
    template_version_id     UUID,
    subject_line               VARCHAR(300),
    idempotency_key               VARCHAR(200) NOT NULL,   -- tenant_id+campaign_run_id+party_id+channel+communication_version
    status                          VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED, SUBMITTED, DELIVERED, OPENED, CLICKED, BOUNCED, COMPLAINED, FAILED
    status_reason                      VARCHAR(200),
    provider_message_id                   VARCHAR(200),        -- Postal message id
    bounce_domain                            VARCHAR(200),
    bounce_type                              VARCHAR(10),         -- HARD, SOFT — drives contact_point_status blocking
    user_agent                                 TEXT,
    ip_address                                   INET,
    submitted_at                                   TIMESTAMPTZ,
    delivered_at                                     TIMESTAMPTZ,
    opened_at                                          TIMESTAMPTZ,
    clicked_at                                           TIMESTAMPTZ,
    bounced_at                                             TIMESTAMPTZ,
    complained_at                                            TIMESTAMPTZ,
    created_at                                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, created_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (created_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE UNIQUE INDEX ux_mailer_execution_idem ON mailer_execution(tenant_id, idempotency_key, created_at);
CREATE INDEX ix_mailer_execution_campaign_run ON mailer_execution(campaign_run_id, status);
CREATE INDEX ix_mailer_execution_party ON mailer_execution(tenant_id, party_id);

CREATE TABLE sms_execution (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    campaign_id         UUID NOT NULL,
    campaign_run_id     UUID NOT NULL,
    campaign_list_member_id BIGINT,
    party_id            VARCHAR(60) NOT NULL,
    phone_number          VARCHAR(30) NOT NULL,
    message_type             VARCHAR(10) NOT NULL DEFAULT 'SMS', -- SMS, MMS
    template_version_id        UUID,
    segment_count                 SMALLINT,
    media_url                       TEXT,                   -- MMS only
    from_sender_id                  VARCHAR(30),            -- iCRM FROM_PHONE: short code / long number the message was sent from
    provider_code                   VARCHAR(40),            -- iCRM SMS_ENGINE (DIGIVIZE, TWILIO ...) — the hardening layer links this to delivery_provider
    internal_batch_id               VARCHAR(250),           -- iCRM INT_BATCH_ID: the worker batch this row was submitted in
    provider_batch_id               VARCHAR(250),           -- iCRM EXT_BATCH_ID: provider-side batch / campaign id
    rendered_text                   TEXT,                   -- iCRM TEXT_CONTENT: exact message body sent (compliance / replay)
    personalization_payload         JSONB,                  -- iCRM PERSONALIZATION_TAGS: merge values used for this recipient
    provider_acked_at               TIMESTAMPTZ,            -- iCRM RESPONSED_TIME: provider HTTP acknowledgement of the submission
    response_code                   VARCHAR(60),            -- iCRM RESPONSE_CODE
    provider_response               JSONB,                  -- iCRM RESPONSED_DATA + RESPONSED_HEADERS
    idempotency_key                    VARCHAR(200) NOT NULL,
    status                                VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED, SUBMITTED, DELIVERED, RESPONDED, FAILED, OPTED_OUT
    status_reason                           VARCHAR(200),
    provider_message_id                        VARCHAR(200), -- Digivize message id
    submitted_at                                  TIMESTAMPTZ,
    delivered_at                                     TIMESTAMPTZ,
    responded_at                                       TIMESTAMPTZ,
    failed_at                                            TIMESTAMPTZ,
    created_at                                              TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, created_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (created_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE UNIQUE INDEX ux_sms_execution_idem ON sms_execution(tenant_id, idempotency_key, created_at);
CREATE INDEX ix_sms_execution_campaign_run ON sms_execution(campaign_run_id, status);
CREATE INDEX ix_sms_execution_party ON sms_execution(tenant_id, party_id);
CREATE INDEX ix_sms_execution_provider_batch ON sms_execution(provider_batch_id);

-- Raw inbound webhook log (Postal delivery/open/click/bounce/complaint; Digivize DLR/response)
-- ahead of applying results to mailer_execution / sms_execution. HIGH VOLUME, partitioned.
CREATE TABLE delivery_webhook_event (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    provider             VARCHAR(20) NOT NULL,             -- POSTAL, DIGIVIZE
    execution_type          VARCHAR(10) NOT NULL,          -- MAILER, SMS
    execution_ref               VARCHAR(200) NOT NULL,     -- provider_message_id / idempotency_key
    event_type                     VARCHAR(30) NOT NULL,
    raw_payload                       JSONB NOT NULL,
    received_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at                            TIMESTAMPTZ,
    processing_status                          VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSED, FAILED
    PRIMARY KEY (id, tenant_id, received_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (received_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_webhook_event_ref ON delivery_webhook_event(execution_ref);
CREATE INDEX ix_webhook_event_pending ON delivery_webhook_event(processing_status) WHERE processing_status = 'PENDING';

-- =====================================================================================
-- 8. ANALYTICAL / REPORTING DATA PRODUCTS  (apps/reporting)
-- BRD 14 / A.4: denormalized datasets the existing (already-rewritten) reporting layer
-- consumes. Modeled here as regular tables populated by analytics Celery workers (nightly +
-- incremental); may be promoted to PostgreSQL materialized views or moved to a separate
-- analytical database later without changing the operational model above.
-- =====================================================================================

CREATE TABLE campaign_master_analytical (
    campaign_id         UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    campaign_name         VARCHAR(200),
    campaign_type            VARCHAR(20),
    channel                     VARCHAR(20),
    status                         VARCHAR(30),
    sent_count                        INTEGER,
    delivered_count                      INTEGER,
    open_count                              INTEGER,
    click_count                                INTEGER,
    bounce_count                                  INTEGER,
    complaint_count                                  INTEGER,
    conversion_count                                    INTEGER,
    target_revenue                                        NUMERIC(14,2),
    attributed_revenue                                       NUMERIC(14,2),
    campaign_cost                                               NUMERIC(14,2),
    campaign_roi                                                   NUMERIC(10,4),
    last_refreshed_at                                                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE journey_master_analytical (
    journey_id          UUID PRIMARY KEY,
    tenant_id            UUID NOT NULL,
    journey_name           VARCHAR(200),
    population_mode           VARCHAR(30),
    status                       VARCHAR(20),
    business_objective              TEXT,
    active_enrollment_count            INTEGER,
    completed_count                       INTEGER,
    exited_count                             INTEGER,
    converted_count                             INTEGER,          -- customers converted by the Goal step
    attributed_revenue                           NUMERIC(14,2),    -- their revenue within the goal's window
    sent_count                                    INTEGER,          -- the journey's messages, every step: sent (submitted)
    delivered_count                                INTEGER,
    open_count                                      INTEGER,
    click_count                                      INTEGER,
    bounce_count                                      INTEGER,
    complaint_count                                    INTEGER,
    held_back_count                                     INTEGER,         -- message steps skipped by governance (consent, caps, suppressions)
    failed_count                                         INTEGER,         -- message steps that could not send
    created_at                                  TIMESTAMPTZ,
    last_refreshed_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HIGH VOLUME flattened Party/Journey/node/event/campaign/channel/outcome facts. Partitioned monthly.
CREATE TABLE journey_execution_master_analytical (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    party_id             VARCHAR(60) NOT NULL,
    journey_id            UUID NOT NULL,
    node_id                 UUID,
    event_type                 VARCHAR(60),
    campaign_id                   UUID,
    campaign_run_id                  UUID,
    channel                             VARCHAR(20),
    outcome                                VARCHAR(30),
    executed_at                               TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (id, tenant_id, executed_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (executed_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.

-- =====================================================================================
-- End of CEP MVP schema.
-- =====================================================================================
