-- Patch 0005: an email template carries its default subject line and preheader, versioned with the rendered content
-- (both may contain {{tags}}; campaign_run_variant.subject_line still overrides per run for A/B tests, TD-04).
-- Idempotent. Apply as the DDL owner.
BEGIN;

ALTER TABLE rendered_template_content
    ADD COLUMN IF NOT EXISTS subject_line VARCHAR(300),
    ADD COLUMN IF NOT EXISTS preheader    VARCHAR(300);

COMMENT ON COLUMN rendered_template_content.subject_line IS 'Default subject for EMAIL / E_RECEIPT templates; may contain {{tags}}; run variants can override';
COMMENT ON COLUMN rendered_template_content.preheader IS 'Inbox preview text shown after the subject';

COMMIT;
