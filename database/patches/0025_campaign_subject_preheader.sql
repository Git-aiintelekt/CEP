-- 0025: a campaign's own subject line and preheader (campaign.subject_line, campaign.preheader; NULL = the template's),
-- set on the setup's Content step. Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
