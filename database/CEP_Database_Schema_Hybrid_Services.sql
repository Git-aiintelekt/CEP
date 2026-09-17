-- =====================================================================================
-- AI-InteleKt CEP — HYBRID SERVICES LAYER
-- Target: PostgreSQL 18+   ·   Run AFTER the MVP core, Enterprise Hardening and SaaS Tenancy layers, BEFORE fn_provision_tenant()
--
-- Architecture: API-first modular monolith (Django + DRF) plus FastAPI services for the hot paths —
-- webhook ingestion, real-time tracking, AI/ML scoring, and any service later extracted from a bottleneck.
-- One PostgreSQL database per pool / dedicated tenant is shared by all processes; the rules are:
--   * Each table has ONE writing owner (see the ownership matrix in CEP_Hybrid_Architecture.md).
--   * Every process sets app.current_tenant / app.current_user_id per transaction — RLS applies to FastAPI exactly as to Django.
--   * Cross-process communication is asynchronous through domain_event (transactional outbox -> Redis Streams) or synchronous
--     through versioned REST; never through another process's tables.
--
-- Sections:
--   1. domain_event                 transactional outbox (owner: every writer; relay: Django worker)
--   2. tracking_link, tracking_event  first-party engagement (owner: FastAPI tracking service)
--   3. ml_model, party_score          scoring (owner: FastAPI scoring service)
--   4. api_client                     API keys for integrations and services (owner: Django)
--   5. webhook_subscription, outbound_webhook_delivery   outbound events to client systems (owner: Django + worker)
--   6. Partition policy, constraints, reference codes, RLS, triggers, catalog comments, FK indexes
-- =====================================================================================

-- =====================================================================================
-- 1. DOMAIN EVENT — transactional outbox
-- =====================================================================================

CREATE TABLE domain_event (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    aggregate_type      VARCHAR(40) NOT NULL,            -- CAMPAIGN, CAMPAIGN_RUN, JOURNEY, CONSENT, ...
    aggregate_id        VARCHAR(60) NOT NULL,            -- UUID or party_id as text
    event_type          VARCHAR(60) NOT NULL,            -- e.g. campaign.published, consent.opted_out, run.completed
    payload             JSONB NOT NULL DEFAULT '{}',
    producer            VARCHAR(20) NOT NULL DEFAULT 'DJANGO', -- DJANGO, INGEST, TRACKING, SCORING, WORKER
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at        TIMESTAMPTZ,
    publish_attempts    INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(10) NOT NULL DEFAULT 'PENDING', -- PENDING, PUBLISHED, FAILED
    PRIMARY KEY (id, tenant_id, occurred_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (occurred_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_domain_event_pending ON domain_event(occurred_at) WHERE status = 'PENDING';
CREATE INDEX ix_domain_event_aggregate ON domain_event(tenant_id, aggregate_type, aggregate_id);

-- =====================================================================================
-- 2. FIRST-PARTY TRACKING — served by the FastAPI tracking service on track.<domain>, never from the CDN
-- =====================================================================================

CREATE TABLE tracking_link (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    template_id         UUID REFERENCES template_master(id),
    campaign_id         UUID REFERENCES campaign(id),
    token               VARCHAR(24) NOT NULL,            -- short, unguessable path segment
    target_url          TEXT NOT NULL,
    link_label          VARCHAR(150),                    -- for click-ranking reports
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, token)
);

CREATE TABLE tracking_event (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    party_id            VARCHAR(60),
    event_type          VARCHAR(30) NOT NULL,            -- OPEN, CLICK, UNSUBSCRIBE_CLICK, PREFERENCE_VIEW, PAGE_VIEW, PURCHASE, CUSTOM
    channel             VARCHAR(20) NOT NULL DEFAULT 'EMAIL', -- EMAIL, SMS, MMS, WEB
    campaign_id         UUID,
    campaign_run_id     UUID,
    mailer_execution_id BIGINT,
    sms_execution_id    BIGINT,
    tracking_link_id    UUID,
    url                 TEXT,
    ip_address          INET,
    user_agent          TEXT,
    is_bot              BOOLEAN NOT NULL DEFAULT FALSE,  -- Apple MPP / security-scanner prefetch detected
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    ingested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at        TIMESTAMPTZ,
    processing_status   VARCHAR(10) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSED, FAILED, IGNORED
    PRIMARY KEY (id, tenant_id, occurred_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (occurred_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_tracking_event_pending ON tracking_event(occurred_at) WHERE processing_status = 'PENDING';
CREATE INDEX ix_tracking_event_party ON tracking_event(tenant_id, party_id, occurred_at);
CREATE INDEX ix_tracking_event_run ON tracking_event(campaign_run_id, event_type);

-- =====================================================================================
-- 3. AI / ML SCORING — written by the FastAPI scoring service, read by list rules and journey conditions
-- =====================================================================================

CREATE TABLE ml_model (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    code                VARCHAR(40) NOT NULL,            -- e.g. PURCHASE_PROPENSITY_30D
    name                VARCHAR(150) NOT NULL,
    model_type          VARCHAR(20) NOT NULL,            -- PROPENSITY, CHURN, CLV, SEND_TIME, NEXT_BEST_ACTION, SEGMENT
    version             INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(10) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ACTIVE, RETIRED
    artifact_ref        VARCHAR(500),                    -- object-store key of the trained artifact
    feature_spec        JSONB NOT NULL DEFAULT '{}',     -- features and their sources (customer_master paths, event aggregates)
    metrics             JSONB NOT NULL DEFAULT '{}',     -- AUC, calibration, drift, evaluated_at
    trained_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code, version)
);
CREATE UNIQUE INDEX ux_ml_model_active ON ml_model(tenant_id, code) WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE TABLE party_score (
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    party_id            VARCHAR(60) NOT NULL,
    model_id            UUID NOT NULL REFERENCES ml_model(id),
    score               NUMERIC(9,6) NOT NULL,           -- normalised 0..1
    band                VARCHAR(20),                     -- HIGH / MEDIUM / LOW, or an hour-of-day for SEND_TIME
    explanation         JSONB,                           -- top contributing features
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until         TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, party_id, model_id)
);
CREATE INDEX ix_party_score_model_band ON party_score(model_id, band);

-- =====================================================================================
-- 4. API CLIENTS — API-first: every integration and service authenticates with a scoped, hashed key
-- =====================================================================================

CREATE TABLE api_client (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(100) NOT NULL,
    client_type         VARCHAR(20) NOT NULL,            -- SERVICE (internal FastAPI service), INTEGRATION (client system), WEBHOOK_SOURCE (inbound webhook caller)
    key_prefix          VARCHAR(20) NOT NULL,            -- visible part, e.g. cep_li_8Fk2Qz ; the rest is only ever shown once
    key_hash            CHAR(64) NOT NULL,               -- sha256 of the full key
    scopes              TEXT[] NOT NULL DEFAULT '{}',    -- e.g. lists:write, events:ingest, scores:read
    allowed_ip_cidrs    TEXT[],
    rate_limit_per_minute INTEGER,
    last_used_at        TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (key_prefix)
);
CREATE INDEX ix_api_client_tenant ON api_client(tenant_id) WHERE revoked_at IS NULL;

-- =====================================================================================
-- 5. OUTBOUND WEBHOOKS — client systems subscribe to domain events
-- =====================================================================================

CREATE TABLE webhook_subscription (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    name                VARCHAR(100) NOT NULL,
    target_url          TEXT NOT NULL,                   -- https only
    secret_ref          VARCHAR(200) NOT NULL,           -- HMAC signing secret held in the vault
    event_types         TEXT[] NOT NULL,                 -- domain_event.event_type patterns, e.g. campaign.*, consent.opted_out
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, DISABLED
    max_attempts        INTEGER NOT NULL DEFAULT 8,
    created_by          UUID REFERENCES app_user(id),
    updated_by          UUID REFERENCES app_user(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE outbound_webhook_delivery (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id           UUID NOT NULL,
    subscription_id     UUID NOT NULL,
    domain_event_id     BIGINT NOT NULL,
    event_type          VARCHAR(60) NOT NULL,
    attempt             INTEGER NOT NULL DEFAULT 1,
    status              VARCHAR(10) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCEEDED, FAILED, DEAD
    response_status     INTEGER,
    response_excerpt    VARCHAR(500),
    next_attempt_at     TIMESTAMPTZ,
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, tenant_id, attempted_at)
) PARTITION BY LIST (tenant_id);
-- Per-tenant partitions (each sub-partitioned RANGE (attempted_at) monthly) are created by fn_provision_tenant() — see the SaaS tenancy layer.
CREATE INDEX ix_outbound_webhook_due ON outbound_webhook_delivery(next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX ix_outbound_webhook_subscription ON outbound_webhook_delivery(subscription_id, attempted_at);

-- =====================================================================================
-- 6. PARTITION POLICY, CONSTRAINTS, REFERENCE CODES, RLS, TRIGGERS, CATALOG
-- =====================================================================================

INSERT INTO partition_retention_policy (table_name, sub_method, sub_key, hash_modulus, retention_months, expiry_action, note) VALUES
    ('domain_event', 'RANGE_MONTHLY', 'occurred_at', NULL, 3, 'DROP', 'Transactional outbox; published events are consumed from the stream, not re-read here'),
    ('tracking_event', 'RANGE_MONTHLY', 'occurred_at', NULL, 12, 'DROP', 'First-party engagement events; rolled into mailer_execution / journey_event / analytics'),
    ('outbound_webhook_delivery', 'RANGE_MONTHLY', 'attempted_at', NULL, 3, 'DROP', 'Outbound webhook attempt log')
ON CONFLICT (table_name) DO NOTHING;

ALTER TABLE domain_event ADD CONSTRAINT ck_domain_event_aggregate_type CHECK (aggregate_type IN ('TENANT', 'CAMPAIGN', 'CAMPAIGN_RUN', 'CONTACT_LIST', 'TEMPLATE', 'JOURNEY', 'JOURNEY_ENROLLMENT', 'CONSENT', 'CONTACT_POINT', 'MEDIA_ASSET'));
ALTER TABLE domain_event ADD CONSTRAINT ck_domain_event_producer CHECK (producer IN ('DJANGO', 'INGEST', 'TRACKING', 'SCORING', 'WORKER'));
ALTER TABLE domain_event ADD CONSTRAINT ck_domain_event_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'));
ALTER TABLE tracking_event ADD CONSTRAINT ck_tracking_event_event_type CHECK (event_type IN ('OPEN', 'CLICK', 'UNSUBSCRIBE_CLICK', 'PREFERENCE_VIEW', 'PAGE_VIEW', 'PURCHASE', 'CUSTOM'));
ALTER TABLE tracking_event ADD CONSTRAINT ck_tracking_event_channel CHECK (channel IN ('EMAIL', 'SMS', 'MMS', 'WEB'));
ALTER TABLE tracking_event ADD CONSTRAINT ck_tracking_event_processing_status CHECK (processing_status IN ('PENDING', 'PROCESSED', 'FAILED', 'IGNORED'));
ALTER TABLE ml_model ADD CONSTRAINT ck_ml_model_model_type CHECK (model_type IN ('PROPENSITY', 'CHURN', 'CLV', 'SEND_TIME', 'NEXT_BEST_ACTION', 'SEGMENT'));
ALTER TABLE ml_model ADD CONSTRAINT ck_ml_model_status CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED'));
ALTER TABLE api_client ADD CONSTRAINT ck_api_client_client_type CHECK (client_type IN ('SERVICE', 'INTEGRATION', 'WEBHOOK_SOURCE'));
ALTER TABLE webhook_subscription ADD CONSTRAINT ck_webhook_subscription_status CHECK (status IN ('ACTIVE', 'PAUSED', 'DISABLED'));
ALTER TABLE outbound_webhook_delivery ADD CONSTRAINT ck_outbound_webhook_delivery_status CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'));
ALTER TABLE domain_event ADD CONSTRAINT ck_domain_event_payload_object CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE tracking_event ADD CONSTRAINT ck_tracking_event_ref CHECK (event_type NOT IN ('OPEN', 'CLICK', 'UNSUBSCRIBE_CLICK') OR mailer_execution_id IS NOT NULL OR sms_execution_id IS NOT NULL);
ALTER TABLE party_score ADD CONSTRAINT ck_party_score_range CHECK (score >= 0 AND score <= 1);
ALTER TABLE ml_model ADD CONSTRAINT ck_ml_model_version CHECK (version > 0);
ALTER TABLE api_client ADD CONSTRAINT ck_api_client_key_prefix CHECK (key_prefix ~ '^cep_[a-z]{2}_[A-Za-z0-9]{6}$');
ALTER TABLE webhook_subscription ADD CONSTRAINT ck_webhook_subscription_url CHECK (target_url ~ '^https://');
ALTER TABLE webhook_subscription ADD CONSTRAINT ck_webhook_subscription_attempts CHECK (max_attempts BETWEEN 1 AND 20);
ALTER TABLE outbound_webhook_delivery ADD CONSTRAINT ck_outbound_webhook_attempt CHECK (attempt > 0);

INSERT INTO reference_code (code_set, code, label, sort_order) VALUES
    ('domain_event.aggregate_type', 'TENANT', 'Tenant', 1),
    ('domain_event.aggregate_type', 'CAMPAIGN', 'Campaign', 2),
    ('domain_event.aggregate_type', 'CAMPAIGN_RUN', 'Campaign Run', 3),
    ('domain_event.aggregate_type', 'CONTACT_LIST', 'Contact List', 4),
    ('domain_event.aggregate_type', 'TEMPLATE', 'Template', 5),
    ('domain_event.aggregate_type', 'JOURNEY', 'Journey', 6),
    ('domain_event.aggregate_type', 'JOURNEY_ENROLLMENT', 'Journey Enrollment', 7),
    ('domain_event.aggregate_type', 'CONSENT', 'Consent', 8),
    ('domain_event.aggregate_type', 'CONTACT_POINT', 'Contact Point', 9),
    ('domain_event.aggregate_type', 'MEDIA_ASSET', 'Media Asset', 10),
    ('domain_event.producer', 'DJANGO', 'Django', 1),
    ('domain_event.producer', 'INGEST', 'Ingest', 2),
    ('domain_event.producer', 'TRACKING', 'Tracking', 3),
    ('domain_event.producer', 'SCORING', 'Scoring', 4),
    ('domain_event.producer', 'WORKER', 'Worker', 5),
    ('domain_event.status', 'PENDING', 'Pending', 1),
    ('domain_event.status', 'PUBLISHED', 'Published', 2),
    ('domain_event.status', 'FAILED', 'Failed', 3),
    ('tracking_event.event_type', 'OPEN', 'Open', 1),
    ('tracking_event.event_type', 'CLICK', 'Click', 2),
    ('tracking_event.event_type', 'UNSUBSCRIBE_CLICK', 'Unsubscribe Click', 3),
    ('tracking_event.event_type', 'PREFERENCE_VIEW', 'Preference View', 4),
    ('tracking_event.event_type', 'PAGE_VIEW', 'Page View', 5),
    ('tracking_event.event_type', 'PURCHASE', 'Purchase', 6),
    ('tracking_event.event_type', 'CUSTOM', 'Custom', 7),
    ('tracking_event.channel', 'EMAIL', 'Email', 1),
    ('tracking_event.channel', 'SMS', 'SMS', 2),
    ('tracking_event.channel', 'MMS', 'MMS', 3),
    ('tracking_event.channel', 'WEB', 'Web', 4),
    ('tracking_event.processing_status', 'PENDING', 'Pending', 1),
    ('tracking_event.processing_status', 'PROCESSED', 'Processed', 2),
    ('tracking_event.processing_status', 'FAILED', 'Failed', 3),
    ('tracking_event.processing_status', 'IGNORED', 'Ignored', 4),
    ('ml_model.model_type', 'PROPENSITY', 'Propensity', 1),
    ('ml_model.model_type', 'CHURN', 'Churn', 2),
    ('ml_model.model_type', 'CLV', 'CLV', 3),
    ('ml_model.model_type', 'SEND_TIME', 'Send Time', 4),
    ('ml_model.model_type', 'NEXT_BEST_ACTION', 'Next Best Action', 5),
    ('ml_model.model_type', 'SEGMENT', 'Segment', 6),
    ('ml_model.status', 'DRAFT', 'Draft', 1),
    ('ml_model.status', 'ACTIVE', 'Active', 2),
    ('ml_model.status', 'RETIRED', 'Retired', 3),
    ('api_client.client_type', 'SERVICE', 'Service', 1),
    ('api_client.client_type', 'INTEGRATION', 'Integration', 2),
    ('api_client.client_type', 'WEBHOOK_SOURCE', 'Webhook Source', 3),
    ('webhook_subscription.status', 'ACTIVE', 'Active', 1),
    ('webhook_subscription.status', 'PAUSED', 'Paused', 2),
    ('webhook_subscription.status', 'DISABLED', 'Disabled', 3),
    ('outbound_webhook_delivery.status', 'PENDING', 'Pending', 1),
    ('outbound_webhook_delivery.status', 'SUCCEEDED', 'Succeeded', 2),
    ('outbound_webhook_delivery.status', 'FAILED', 'Failed', 3),
    ('outbound_webhook_delivery.status', 'DEAD', 'Dead', 4)
ON CONFLICT (code_set, code) DO NOTHING;

ALTER TABLE domain_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_event FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_domain_event_tenant ON domain_event
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tracking_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_link FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tracking_link_tenant ON tracking_link
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE tracking_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_event FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_tracking_event_tenant ON tracking_event
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE ml_model ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_model FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_ml_model_tenant ON ml_model
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE party_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_score FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_party_score_tenant ON party_score
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE api_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_client FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_api_client_tenant ON api_client
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE webhook_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_webhook_subscription_tenant ON webhook_subscription
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
ALTER TABLE outbound_webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_outbound_webhook_delivery_tenant ON outbound_webhook_delivery
    USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

CREATE TRIGGER trg_ml_model_touch BEFORE UPDATE ON ml_model FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_ml_model_audit AFTER INSERT OR UPDATE OR DELETE ON ml_model FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_api_client_touch BEFORE UPDATE ON api_client FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_api_client_audit AFTER INSERT OR UPDATE OR DELETE ON api_client FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();
CREATE TRIGGER trg_webhook_subscription_touch BEFORE UPDATE ON webhook_subscription FOR EACH ROW EXECUTE FUNCTION fn_touch_row();
CREATE TRIGGER trg_webhook_subscription_audit AFTER INSERT OR UPDATE OR DELETE ON webhook_subscription FOR EACH ROW EXECUTE FUNCTION fn_definition_audit();

COMMENT ON TABLE domain_event IS 'Transactional outbox: every business change writes an event in the same transaction; a relay publishes it to the event stream for FastAPI services, workers and client webhooks';
COMMENT ON TABLE tracking_link IS 'Registry of trackable links in a template: the click-redirect endpoint resolves a short token to the target URL';
COMMENT ON TABLE tracking_event IS 'First-party engagement captured by the FastAPI tracking service (open pixel, click redirect, unsubscribe click, web/purchase events); processed asynchronously (tenant + monthly partitioned)';
COMMENT ON TABLE ml_model IS 'Registry of scoring models (propensity, churn, CLV, send-time, next-best-action) with artifact reference, feature spec and metrics';
COMMENT ON TABLE party_score IS 'Latest score per party per model, written by the FastAPI scoring service; consumed by dynamic list criteria and journey conditions';
COMMENT ON TABLE api_client IS 'API keys for integrations and services: hashed key, scopes, IP allow-list, rate limit, expiry / revocation';
COMMENT ON TABLE webhook_subscription IS 'Outbound webhooks to client systems: which event types go to which HTTPS endpoint, signed with a secret held by reference';
COMMENT ON TABLE outbound_webhook_delivery IS 'Attempt log for outbound webhooks with retry schedule and dead-lettering (tenant + monthly partitioned)';
COMMENT ON COLUMN tracking_event.ip_address IS 'PII: engagement IP address (GDPR personal data)';
COMMENT ON COLUMN tracking_event.user_agent IS 'PII-possible: device fingerprint';
COMMENT ON COLUMN api_client.key_hash IS 'Secret material (hashed): never log or export';

CREATE INDEX ix_tracking_link_template_id ON tracking_link(template_id);
CREATE INDEX ix_tracking_link_campaign_id ON tracking_link(campaign_id);
CREATE INDEX ix_party_score_model_id ON party_score(model_id);
CREATE INDEX ix_ml_model_tenant_id ON ml_model(tenant_id);
CREATE INDEX ix_webhook_subscription_tenant_id ON webhook_subscription(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cep_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO cep_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO cep_admin;

-- =====================================================================================
-- End of hybrid services layer.
-- =====================================================================================
