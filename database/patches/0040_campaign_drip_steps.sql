-- 0040: campaign_drip_step, one row per message of a drip campaign (its own template copy, day, send time, subject /
-- preheader overrides, A/B subject test), and the backfill of existing drips from campaign.drip_config.steps.
-- Idempotent: re-runs the platform-operations layer, same pattern as 0036/0037.
\ir ../CEP_Database_Schema_Platform_Operations.sql
