-- 0042: campaign_run.drip_step_id, the message a drip run sends, and the backfill of existing drip runs by their "Day N" label.
-- Idempotent: re-runs the platform-operations layer, same pattern as 0041.
\ir ../CEP_Database_Schema_Platform_Operations.sql
