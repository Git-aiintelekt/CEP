-- 0084 (2026-11-18): Delivery Warm-Up. A new sending IP or domain sends a little more each day: an hourly schedule sized to the
-- workspace plan's contacts, lists and a template per day, CEP's own warm-up emails as WARM_UP campaigns, and every marketing
-- email held to the hour's limit. campaign_type takes WARM_UP; delivery_warmup, delivery_warmup_day, delivery_warmup_send and
-- delivery_warmup_campaign, with row-level security; a partial index on the held mailer_execution rows.
-- Apply with database/apply_patch.sh 0084_delivery_warmup.sql, which also records it.
\ir ../CEP_Database_Schema_Platform_Operations.sql
