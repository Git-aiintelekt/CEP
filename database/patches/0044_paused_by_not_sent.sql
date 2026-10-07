-- 0044: campaign.paused_at / paused_by (who paused, and when), and not_sent_reason on mailer_execution / sms_execution
-- (STOPPED_EARLY: queued messages a drip stop left unsent, counted as not sent rather than failed), with the backfill of
-- rows written before the column. Idempotent: re-runs the platform-operations layer, same pattern as 0043.
\ir ../CEP_Database_Schema_Platform_Operations.sql
