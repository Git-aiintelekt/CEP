-- 0023: A/B subject lines (campaign.ab_config, campaign_run.ab_decide_at, mailer_execution.variant_key) and send-time optimisation
-- (mailer_execution.send_after, sms_execution.send_after). Idempotent: re-runs the platform-operations layer.
\ir ../CEP_Database_Schema_Platform_Operations.sql
